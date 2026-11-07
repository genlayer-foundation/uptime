// SPDX-License-Identifier: MIT

// ==============================================================================
// NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
// ==============================================================================

pragma solidity 0.8.37;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Uptime pools v2: community-backed GEN pools, spent pro-rata through capped allowances
/// @notice Same product as UptimePool v1 (a pool per `uptimeId`, spender roles drawing within the
/// allowances the pool OWNER grants), with one change: ANYONE can back a pool. Every contribution is
/// recorded per (pool, contributor) as shares; a charge lowers the pool's balance and so every
/// backer's balance in proportion (pro-rata); each backer can withdraw their own unspent share at
/// any time, paused or not. The owner keeps sole control of allowances and pausing but can no
/// longer move anyone else's GEN: the owner's withdraw is limited to the owner's own share.
/// @dev Charge rule: PRO-RATA via shares (ERC-4626 style, no token). A contribution mints
/// `amount * totalShares / balance` shares (`amount * SCALE` into an empty pool); a backer's
/// balance is `shares * balance / totalShares`. Every path is O(1) in the number of backers.
/// Rounding always favours the pool: mint and payout round down, burn rounds up, so the pool is
/// always solvent: sum(balanceOf) <= balance, the gap is < 1 wei per backer, and the sole (last)
/// backer is owed exactly the whole balance, so the last one out leaves the pool at 0. When a
/// charge empties a pool its share epoch advances: every old share is worth nothing (there is
/// nothing left) and the next contribution starts fresh. Share math is full-precision mulDiv
/// (a port of OpenZeppelin Math.mulDiv, inlined because only ReentrancyGuard is vendored).
/// Patterns kept from v1: ReentrancyGuard on every state-changing entry point,
/// checks-effects-interactions, revert on a rejected transfer, permanent history, no receive or
/// fallback, spender roles behind an admin with a fixed rotation delay, per-period and per-line
/// caps, strictly increasing settlement ids, skip-not-revert charge lines.
contract UptimePoolV2 is ReentrancyGuard {
    /// @notice Allowance terms, as the owner grants them (identical to v1).
    struct Terms {
        uint128 periodAmount;
        uint64 periodDuration;
        uint64 startDate;
        uint64 expiry;
        uint128 maxPerCharge;
    }

    struct Allowance {
        Terms terms;
        uint128 spentInPeriod;
        uint64 lastPeriod;
        bool paused;
        bool active;
    }

    struct Pool {
        address owner;
        bool paused;
        uint64 epoch;
        uint256 balance;
        uint256 totalShares;
        uint256 backers;
    }

    struct Stake {
        uint256 shares;
        uint64 epoch;
        bool listed;
    }

    struct PendingSpender {
        address spender;
        uint64 eta;
        bool exists;
    }

    /// @dev kind: 1 create, 2 contribution, 3 withdraw, 4 charge, 5 pause, 6 unpause, 7 allowance
    /// set, 8 allowance revoked, 9 allowance paused, 10 allowance unpaused, 11 shares reset (the pool
    /// was charged empty). actor is the contributor for 1-3. role is set for 4 and 7-10. recipient
    /// is set for 3 and 4. settlementId for 4 and 11.
    struct Operation {
        bytes32 uptimeId;
        address actor;
        uint64 timestamp;
        uint8 kind;
        uint8 role;
        uint256 amount;
        address recipient;
        uint256 settlementId;
    }

    enum SkipReason {
        None,
        NoPool,
        PoolPaused,
        NoAllowance,
        AllowancePaused,
        NotStarted,
        Expired,
        ZeroAmount,
        OverLineCap,
        OverPeriodCap,
        InsufficientBalance
    }

    uint8 public constant ROLE_SCHEDULER = 1;
    uint8 public constant ROLE_MAILER = 2;
    uint256 public constant MAX_BATCH = 256;
    uint256 private constant MAX_PAGE = 128;
    /// @notice Pass as `amount` to withdraw your whole share (avoids racing an in-flight charge).
    uint256 public constant ALL = type(uint256).max;
    /// @notice Shares minted per wei into an empty pool. High precision keeps every rounding loss
    /// far below one wei.
    uint256 public constant SCALE = 1e18;

    address public immutable admin;
    uint64 public immutable rotationDelay;

    mapping(bytes32 uptimeId => Pool) private _pools;
    mapping(bytes32 uptimeId => mapping(address contributor => Stake)) private _stakes;
    mapping(bytes32 uptimeId => address[]) private _contributors;
    mapping(bytes32 uptimeId => mapping(uint8 role => Allowance)) private _allowances;
    mapping(uint8 role => address) public spenderOf;
    mapping(address spender => uint8) public roleOf;
    mapping(uint8 role => uint256) public lastSettlement;
    mapping(uint8 role => PendingSpender) private _pending;
    uint256 public totalBalance;
    Operation[] private _history;

    error ZeroAmount();
    error ZeroShares();
    error InvalidUptimeId();
    error PoolExists();
    error UnknownPool();
    error NotPoolOwner();
    error InsufficientBalance(uint256 available, uint256 requested);
    error InvalidRecipient();
    error InvalidRole();
    error InvalidTerms();
    error LengthMismatch();
    error InvalidBatch();
    error NotSpender();
    error SettlementReplayed(uint256 last, uint256 given);
    error NativeTransferFailed();
    error NotAdmin();
    error InvalidAdmin();
    error SpenderHasRole(uint8 role);
    error NoPendingSpender();
    error RotationNotReady(uint64 eta);
    error InvalidHistoryLimit();
    error InvalidHistoryOffset();
    error MathOverflow();

    event PoolCreated(bytes32 indexed uptimeId, address indexed owner, uint256 amount);
    event Contributed(bytes32 indexed uptimeId, address indexed contributor, uint256 amount, uint256 shares);
    event Withdrawn(
        bytes32 indexed uptimeId,
        address indexed contributor,
        address indexed recipient,
        uint256 amount,
        uint256 shares
    );
    event SharesReset(bytes32 indexed uptimeId, uint64 epoch);
    event PoolPaused(bytes32 indexed uptimeId, bool paused);
    event AllowanceSet(bytes32 indexed uptimeId, uint8 indexed role, Terms terms);
    event AllowanceRevoked(bytes32 indexed uptimeId, uint8 indexed role);
    event AllowancePaused(bytes32 indexed uptimeId, uint8 indexed role, bool paused);
    event Charged(bytes32 indexed uptimeId, uint8 indexed role, uint256 indexed settlementId, uint256 amount);
    event ChargeSkipped(
        bytes32 indexed uptimeId,
        uint8 indexed role,
        uint256 indexed settlementId,
        uint256 amount,
        SkipReason reason
    );
    event Settled(uint8 indexed role, uint256 indexed settlementId, address indexed spender, uint256 total);
    event SpenderProposed(uint8 indexed role, address indexed spender, uint64 eta);
    event SpenderProposalCancelled(uint8 indexed role);
    event SpenderChanged(uint8 indexed role, address indexed previous, address indexed spender);

    constructor(address admin_, uint64 rotationDelay_, address scheduler, address mailer) {
        if (admin_ == address(0)) revert InvalidAdmin();
        if (scheduler != address(0) && scheduler == mailer) revert SpenderHasRole(ROLE_SCHEDULER);
        admin = admin_;
        rotationDelay = rotationDelay_;
        if (scheduler != address(0)) _setSpender(ROLE_SCHEDULER, scheduler);
        if (mailer != address(0)) _setSpender(ROLE_MAILER, mailer);
    }

    // ---------------------------------------------------------------- pools and backers

    /// @notice Create the pool for `uptimeId` with `msg.value` as the caller's first contribution,
    /// and grant allowances. The caller becomes the owner. Reverts if the id is taken.
    function deposit(bytes32 uptimeId, uint8[] calldata roles, Terms[] calldata terms)
        external
        payable
        nonReentrant
    {
        if (uptimeId == bytes32(0)) revert InvalidUptimeId();
        if (msg.value == 0) revert ZeroAmount();
        if (roles.length != terms.length) revert LengthMismatch();
        Pool storage pool = _pools[uptimeId];
        if (pool.owner != address(0)) revert PoolExists();

        pool.owner = msg.sender;
        pool.epoch = 1;
        _record(uptimeId, 1, 0, msg.value, address(0), 0);
        emit PoolCreated(uptimeId, msg.sender, msg.value);
        _contribute(uptimeId, pool, msg.value);

        for (uint256 i; i < roles.length; ++i) {
            _setAllowance(uptimeId, roles[i], terms[i]);
        }
    }

    /// @notice Back an existing pool with `msg.value`. Anyone may; the GEN stays yours to withdraw
    /// (less your pro-rata part of what the pool's runs have spent).
    function topUp(bytes32 uptimeId) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        Pool storage pool = _pools[uptimeId];
        if (pool.owner == address(0)) revert UnknownPool();
        _record(uptimeId, 2, 0, msg.value, address(0), 0);
        _contribute(uptimeId, pool, msg.value);
    }

    /// @notice Withdraw from YOUR share to yourself, immediately, paused or not. `ALL` takes it all.
    function withdraw(bytes32 uptimeId, uint256 amount) external nonReentrant returns (uint256) {
        return _withdraw(uptimeId, amount, payable(msg.sender));
    }

    /// @notice Withdraw from YOUR share to `recipient`, immediately.
    /// @dev A failed transfer reverts the whole call. Never name a contract that credits its sender.
    function withdrawTo(bytes32 uptimeId, uint256 amount, address payable recipient)
        external
        nonReentrant
        returns (uint256)
    {
        if (recipient == address(0)) revert InvalidRecipient();
        return _withdraw(uptimeId, amount, recipient);
    }

    // ---------------------------------------------------------------- owner

    /// @notice The kill switch: a paused pool refuses every charge from every spender. Owner only.
    function setPaused(bytes32 uptimeId, bool paused) external nonReentrant {
        Pool storage pool = _ownedPool(uptimeId);
        pool.paused = paused;
        _record(uptimeId, paused ? 5 : 6, 0, 0, address(0), 0);
        emit PoolPaused(uptimeId, paused);
    }

    function setAllowance(bytes32 uptimeId, uint8 role, Terms calldata terms) external nonReentrant {
        _ownedPool(uptimeId);
        _setAllowance(uptimeId, role, terms);
    }

    function setAllowancePaused(bytes32 uptimeId, uint8 role, bool paused) external nonReentrant {
        _ownedPool(uptimeId);
        Allowance storage a = _allowances[uptimeId][role];
        if (!a.active) revert InvalidRole();
        a.paused = paused;
        _record(uptimeId, paused ? 9 : 10, role, 0, address(0), 0);
        emit AllowancePaused(uptimeId, role, paused);
    }

    function revokeAllowance(bytes32 uptimeId, uint8 role) external nonReentrant {
        _ownedPool(uptimeId);
        if (!_allowances[uptimeId][role].active) revert InvalidRole();
        delete _allowances[uptimeId][role];
        _record(uptimeId, 8, role, 0, address(0), 0);
        emit AllowanceRevoked(uptimeId, role);
    }

    // ---------------------------------------------------------------- spenders

    /// @notice Draw `amounts[i]` from pool `ids[i]` under the caller's role allowance, paying the
    /// total to the caller. Identical rules to v1; a charge lowers every backer pro-rata.
    function charge(bytes32[] calldata ids, uint256[] calldata amounts, uint256 settlementId)
        external
        nonReentrant
        returns (uint256 total)
    {
        uint8 role = roleOf[msg.sender];
        if (role == 0) revert NotSpender();
        if (ids.length != amounts.length) revert LengthMismatch();
        if (ids.length == 0 || ids.length > MAX_BATCH) revert InvalidBatch();
        uint256 last = lastSettlement[role];
        if (settlementId <= last) revert SettlementReplayed(last, settlementId);
        lastSettlement[role] = settlementId;

        for (uint256 i; i < ids.length; ++i) {
            SkipReason reason = _chargeLine(ids[i], role, amounts[i]);
            if (reason == SkipReason.None) {
                total += amounts[i];
                _record(ids[i], 4, role, amounts[i], msg.sender, settlementId);
                emit Charged(ids[i], role, settlementId, amounts[i]);
                Pool storage pool = _pools[ids[i]];
                if (pool.balance == 0 && pool.totalShares != 0) {
                    // Charged empty: every share is worth nothing; start a fresh epoch.
                    pool.epoch += 1;
                    pool.totalShares = 0;
                    pool.backers = 0;
                    _record(ids[i], 11, role, 0, address(0), settlementId);
                    emit SharesReset(ids[i], pool.epoch);
                }
            } else {
                emit ChargeSkipped(ids[i], role, settlementId, amounts[i], reason);
            }
        }

        emit Settled(role, settlementId, msg.sender, total);
        if (total != 0) {
            (bool sent,) = payable(msg.sender).call{ value: total }("");
            if (!sent) revert NativeTransferFailed();
        }
    }

    // ---------------------------------------------------------------- admin

    function proposeSpender(uint8 role, address spender) external nonReentrant {
        if (msg.sender != admin) revert NotAdmin();
        if (role == 0) revert InvalidRole();
        uint64 eta = uint64(block.timestamp) + rotationDelay;
        _pending[role] = PendingSpender({ spender: spender, eta: eta, exists: true });
        emit SpenderProposed(role, spender, eta);
    }

    function cancelSpender(uint8 role) external nonReentrant {
        if (msg.sender != admin) revert NotAdmin();
        if (!_pending[role].exists) revert NoPendingSpender();
        delete _pending[role];
        emit SpenderProposalCancelled(role);
    }

    function executeSpender(uint8 role) external nonReentrant {
        if (msg.sender != admin) revert NotAdmin();
        PendingSpender memory p = _pending[role];
        if (!p.exists) revert NoPendingSpender();
        if (block.timestamp < p.eta) revert RotationNotReady(p.eta);
        delete _pending[role];
        _setSpender(role, p.spender);
    }

    // ---------------------------------------------------------------- views

    function getPool(bytes32 uptimeId) external view returns (address owner, bool paused, uint256 balance) {
        Pool storage pool = _pools[uptimeId];
        return (pool.owner, pool.paused, pool.balance);
    }

    /// @notice How many addresses back the pool now (non-zero shares), and its balance.
    function getBacking(bytes32 uptimeId) external view returns (uint256 backers, uint256 balance) {
        Pool storage pool = _pools[uptimeId];
        return (pool.backers, pool.balance);
    }

    /// @notice Share bookkeeping: total shares and the current epoch.
    function getShares(bytes32 uptimeId) external view returns (uint256 totalShares, uint64 epoch) {
        Pool storage pool = _pools[uptimeId];
        return (pool.totalShares, pool.epoch);
    }

    function sharesOf(bytes32 uptimeId, address contributor) public view returns (uint256) {
        Stake storage s = _stakes[uptimeId][contributor];
        return s.epoch == _pools[uptimeId].epoch ? s.shares : 0;
    }

    /// @notice What `contributor` could withdraw from `uptimeId` right now.
    function balanceOf(bytes32 uptimeId, address contributor) public view returns (uint256) {
        Pool storage pool = _pools[uptimeId];
        return _valueOf(pool, sharesOf(uptimeId, contributor));
    }

    /// @notice Everyone who ever backed the pool, in first-contribution order, with what each can
    /// withdraw now (0 for those who left or were charged out).
    /// @param offset Zero-based index. Equal to total returns an empty page; greater reverts.
    /// @param limit Page size, 1 to 128.
    function getContributors(bytes32 uptimeId, uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory who, uint256[] memory balances, uint256 total)
    {
        if (limit == 0 || limit > MAX_PAGE) revert InvalidHistoryLimit();
        address[] storage list = _contributors[uptimeId];
        total = list.length;
        if (offset > total) revert InvalidHistoryOffset();
        uint256 count = total - offset;
        if (count > limit) count = limit;
        who = new address[](count);
        balances = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            who[i] = list[offset + i];
            balances[i] = balanceOf(uptimeId, who[i]);
        }
    }

    function getAllowance(bytes32 uptimeId, uint8 role)
        external
        view
        returns (Terms memory terms, uint256 spentInPeriod, uint256 lastPeriod, bool paused, bool active)
    {
        Allowance storage a = _allowances[uptimeId][role];
        return (a.terms, a.spentInPeriod, a.lastPeriod, a.paused, a.active);
    }

    function available(bytes32 uptimeId, uint8 role) external view returns (uint256 amount) {
        Pool storage pool = _pools[uptimeId];
        Allowance storage a = _allowances[uptimeId][role];
        if (pool.owner == address(0) || pool.paused || !a.active || a.paused) return 0;
        if (block.timestamp < a.terms.startDate) return 0;
        if (a.terms.expiry != 0 && block.timestamp >= a.terms.expiry) return 0;
        amount = _periodRemaining(a);
        if (a.terms.maxPerCharge != 0 && amount > a.terms.maxPerCharge) amount = a.terms.maxPerCharge;
        if (amount > pool.balance) amount = pool.balance;
    }

    function pendingSpender(uint8 role) external view returns (address spender, uint64 eta, bool exists) {
        PendingSpender storage p = _pending[role];
        return (p.spender, p.eta, p.exists);
    }

    function getHistory(uint256 offset, uint256 limit)
        external
        view
        returns (Operation[] memory records, uint256 total)
    {
        if (limit == 0 || limit > MAX_PAGE) revert InvalidHistoryLimit();
        total = _history.length;
        if (offset > total) revert InvalidHistoryOffset();
        uint256 count = total - offset;
        if (count > limit) count = limit;
        records = new Operation[](count);
        for (uint256 i; i < count; ++i) {
            records[i] = _history[offset + i];
        }
    }

    // ---------------------------------------------------------------- internals

    function _ownedPool(bytes32 uptimeId) private view returns (Pool storage pool) {
        pool = _pools[uptimeId];
        if (pool.owner == address(0)) revert UnknownPool();
        if (pool.owner != msg.sender) revert NotPoolOwner();
    }

    function _valueOf(Pool storage pool, uint256 shares) private view returns (uint256) {
        if (shares == 0) return 0;
        if (shares == pool.totalShares) return pool.balance; // the sole backer owns every wei
        return _mulDiv(shares, pool.balance, pool.totalShares);
    }

    function _contribute(bytes32 uptimeId, Pool storage pool, uint256 amount) private {
        uint256 minted = pool.totalShares == 0
            ? _mulDiv(amount, SCALE, 1)
            : _mulDiv(amount, pool.totalShares, pool.balance);
        if (minted == 0) revert ZeroShares();

        Stake storage s = _stakes[uptimeId][msg.sender];
        if (s.epoch != pool.epoch) {
            s.epoch = pool.epoch;
            s.shares = 0;
        }
        if (s.shares == 0) pool.backers += 1;
        if (!s.listed) {
            s.listed = true;
            _contributors[uptimeId].push(msg.sender);
        }
        s.shares += minted;
        pool.totalShares += minted;
        pool.balance += amount;
        totalBalance += amount;
        emit Contributed(uptimeId, msg.sender, amount, minted);
    }

    function _withdraw(bytes32 uptimeId, uint256 amount, address payable recipient)
        private
        returns (uint256)
    {
        Pool storage pool = _pools[uptimeId];
        if (pool.owner == address(0)) revert UnknownPool();
        Stake storage s = _stakes[uptimeId][msg.sender];
        uint256 shares = s.epoch == pool.epoch ? s.shares : 0;
        uint256 owned = _valueOf(pool, shares);
        uint256 burn;

        if (amount == ALL) {
            if (shares == 0) revert ZeroAmount();
            amount = owned;
            burn = shares;
        } else {
            if (amount == 0) revert ZeroAmount();
            if (amount > owned) revert InsufficientBalance(owned, amount);
            if (amount == pool.balance) {
                burn = shares; // only the sole backer can own the whole balance
            } else {
                burn = _mulDivUp(amount, pool.totalShares, pool.balance);
                // Never strand GEN behind zero shares: whoever burns the last share takes the rest.
                if (burn >= pool.totalShares) burn = pool.totalShares - 1;
                if (burn > shares) revert InsufficientBalance(owned, amount);
            }
        }

        s.shares = shares - burn;
        if (shares != 0 && s.shares == 0) pool.backers -= 1;
        pool.totalShares -= burn;
        pool.balance -= amount;
        totalBalance -= amount;
        _record(uptimeId, 3, 0, amount, recipient, 0);
        emit Withdrawn(uptimeId, msg.sender, recipient, amount, burn);

        if (amount != 0) {
            (bool sent,) = recipient.call{ value: amount }("");
            if (!sent) revert NativeTransferFailed();
        }
        return amount;
    }

    function _setAllowance(bytes32 uptimeId, uint8 role, Terms calldata terms) private {
        if (role == 0) revert InvalidRole();
        if (terms.periodAmount == 0 || terms.periodDuration == 0) revert InvalidTerms();
        Terms memory t = terms;
        if (t.startDate == 0) t.startDate = uint64(block.timestamp);
        if (t.expiry != 0 && t.expiry <= t.startDate) revert InvalidTerms();
        _allowances[uptimeId][role] =
            Allowance({ terms: t, spentInPeriod: 0, lastPeriod: 0, paused: false, active: true });
        _record(uptimeId, 7, role, t.periodAmount, address(0), 0);
        emit AllowanceSet(uptimeId, role, t);
    }

    function _periodRemaining(Allowance storage a) private view returns (uint256) {
        uint64 current = uint64((block.timestamp - a.terms.startDate) / a.terms.periodDuration);
        if (current != a.lastPeriod) return a.terms.periodAmount;
        return uint256(a.terms.periodAmount) - a.spentInPeriod;
    }

    function _chargeLine(bytes32 uptimeId, uint8 role, uint256 amount) private returns (SkipReason) {
        Pool storage pool = _pools[uptimeId];
        if (pool.owner == address(0)) return SkipReason.NoPool;
        if (pool.paused) return SkipReason.PoolPaused;
        Allowance storage a = _allowances[uptimeId][role];
        if (!a.active) return SkipReason.NoAllowance;
        if (a.paused) return SkipReason.AllowancePaused;
        if (block.timestamp < a.terms.startDate) return SkipReason.NotStarted;
        if (a.terms.expiry != 0 && block.timestamp >= a.terms.expiry) return SkipReason.Expired;
        if (amount == 0) return SkipReason.ZeroAmount;
        if (a.terms.maxPerCharge != 0 && amount > a.terms.maxPerCharge) return SkipReason.OverLineCap;

        uint64 current = uint64((block.timestamp - a.terms.startDate) / a.terms.periodDuration);
        uint256 spent = current == a.lastPeriod ? a.spentInPeriod : 0;
        if (amount > uint256(a.terms.periodAmount) - spent) return SkipReason.OverPeriodCap;
        if (amount > pool.balance) return SkipReason.InsufficientBalance;

        a.lastPeriod = current;
        // casting to 'uint128' is safe because spent + amount <= periodAmount, itself a uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        a.spentInPeriod = uint128(spent + amount);
        pool.balance -= amount;
        totalBalance -= amount;
        return SkipReason.None;
    }

    function _setSpender(uint8 role, address spender) private {
        if (spender != address(0)) {
            uint8 held = roleOf[spender];
            if (held != 0 && held != role) revert SpenderHasRole(held);
        }
        address previous = spenderOf[role];
        if (previous != address(0)) delete roleOf[previous];
        spenderOf[role] = spender;
        if (spender != address(0)) roleOf[spender] = role;
        emit SpenderChanged(role, previous, spender);
    }

    function _record(
        bytes32 uptimeId,
        uint8 kind,
        uint8 role,
        uint256 amount,
        address recipient,
        uint256 settlementId
    ) private {
        _history.push(
            Operation({
                uptimeId: uptimeId,
                actor: msg.sender,
                timestamp: uint64(block.timestamp),
                kind: kind,
                role: role,
                amount: amount,
                recipient: recipient,
                settlementId: settlementId
            })
        );
    }

    // ---------------------------------------------------------------- math

    function _mulDivUp(uint256 x, uint256 y, uint256 d) private pure returns (uint256 r) {
        r = _mulDiv(x, y, d);
        if (mulmod(x, y, d) != 0) r += 1;
    }

    /// @dev floor(x * y / d) with a 512-bit intermediate; reverts if the result overflows or d == 0.
    /// Port of OpenZeppelin Math.mulDiv (MIT), Remco Bloemen's algorithm.
    function _mulDiv(uint256 x, uint256 y, uint256 d) private pure returns (uint256 result) {
        unchecked {
            uint256 prod0 = x * y;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                if (d == 0) revert MathOverflow();
                return prod0 / d;
            }
            if (d <= prod1) revert MathOverflow();

            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, d)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = d & (0 - d);
            assembly {
                d := div(d, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * d) ^ 2;
            inverse *= 2 - d * inverse;
            inverse *= 2 - d * inverse;
            inverse *= 2 - d * inverse;
            inverse *= 2 - d * inverse;
            inverse *= 2 - d * inverse;
            inverse *= 2 - d * inverse;
            result = prod0 * inverse;
        }
    }

    // No receive/fallback: plain transfers and unknown selectors are rejected.
}
