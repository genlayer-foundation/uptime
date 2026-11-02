// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Uptime pools: native GEN locked per uptime, spent only through capped allowances
/// @notice A user locks GEN in a pool keyed by an `uptimeId`. Uptime's off-chain services
/// (the scheduler that fronts run gas, the mailer that pays email fees) are SPENDERS. Each spender
/// can draw from a pool only within the allowance the pool's owner granted it: an amount per period
/// (the semantics of MetaMask's NativeTokenPeriodTransferEnforcer, so a later move to ERC-7710
/// delegations swaps the payer and keeps the product unchanged), an optional cap per charged line
/// (one run, one email), an optional expiry, and a pause. The owner can pause the whole pool,
/// pause or revoke any one allowance, and withdraw any amount at any time, immediately.
/// @dev Spenders are addressed by ROLE (1 = scheduler, 2 = mailer, any other non-zero id the
/// admin assigns). Users grant allowances to a role; the admin maps a role to an address. The
/// admin's only power is that mapping, behind `rotationDelay` (which may be zero, see the
/// constructor); it cannot move, freeze or redirect a pool's balance, and cannot raise any
/// allowance. Patterns kept from NativeGenStaking (validator-staking-program-tge): OpenZeppelin
/// ReentrancyGuard on every state-changing entry point, checks-effects-interactions on every
/// payout, revert on a rejected transfer, a permanent operation history mirrored by events, and no
/// receive or fallback.
contract UptimePool is ReentrancyGuard {
    /// @notice Allowance terms, as the owner grants them.
    /// @param periodAmount Max wei the spender may draw in one period. Must be non-zero.
    /// @param periodDuration Period length in seconds (86400 = per day). Must be non-zero.
    /// @param startDate Period 0 starts here; 0 means "now". Nothing can be drawn before it.
    /// @param expiry Charges at or after this timestamp are refused; 0 means never.
    /// @param maxPerCharge Max wei for ONE charged line (one run, one email); 0 means no line cap.
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
        uint256 balance;
    }

    struct PendingSpender {
        address spender;
        uint64 eta;
        bool exists;
    }

    /// @dev kind: 1 create, 2 top-up, 3 withdraw, 4 charge, 5 pause, 6 unpause, 7 allowance set,
    /// 8 allowance revoked, 9 allowance paused, 10 allowance unpaused. Array position is the ID.
    /// role is set for kinds 4 and 7-10. recipient is set for kinds 3 and 4. settlementId for 4.
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

    /// @notice Why a charge line was refused. A refused line moves nothing; the rest of the batch
    /// still settles, so one pool pausing cannot block every other pool's settlement.
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
    uint256 private constant MAX_HISTORY_PAGE = 128;
    /// @notice Pass as `amount` to withdraw the whole balance (avoids racing an in-flight charge).
    uint256 public constant ALL = type(uint256).max;

    /// @notice The only address that can change which address holds a spender role.
    address public immutable admin;
    /// @notice Seconds between proposing and executing a spender change. Fixed at deployment.
    uint64 public immutable rotationDelay;

    mapping(bytes32 uptimeId => Pool) private _pools;
    mapping(bytes32 uptimeId => mapping(uint8 role => Allowance)) private _allowances;
    mapping(uint8 role => address) public spenderOf;
    mapping(address spender => uint8) public roleOf;
    mapping(uint8 role => uint256) public lastSettlement;
    mapping(uint8 role => PendingSpender) private _pending;
    uint256 public totalBalance;
    Operation[] private _history;

    error ZeroAmount();
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

    event PoolCreated(bytes32 indexed uptimeId, address indexed owner, uint256 amount);
    event ToppedUp(bytes32 indexed uptimeId, uint256 amount);
    event Withdrawn(bytes32 indexed uptimeId, address indexed recipient, uint256 amount);
    event PoolPaused(bytes32 indexed uptimeId, bool paused);
    event AllowanceSet(bytes32 indexed uptimeId, uint8 indexed role, Terms terms);
    event AllowanceRevoked(bytes32 indexed uptimeId, uint8 indexed role);
    event AllowancePaused(bytes32 indexed uptimeId, uint8 indexed role, bool paused);
    event Charged(bytes32 indexed uptimeId, uint8 indexed role, uint256 indexed settlementId, uint256 amount);
    event ChargeSkipped(
        bytes32 indexed uptimeId, uint8 indexed role, uint256 indexed settlementId, uint256 amount, SkipReason reason
    );
    event Settled(uint8 indexed role, uint256 indexed settlementId, address indexed spender, uint256 total);
    event SpenderProposed(uint8 indexed role, address indexed spender, uint64 eta);
    event SpenderProposalCancelled(uint8 indexed role);
    event SpenderChanged(uint8 indexed role, address indexed previous, address indexed spender);

    /// @param admin_ Address allowed to rotate spender roles. Use a multisig.
    /// @param rotationDelay_ Wait between proposing and executing a rotation. Design D11 suggests
    /// 48 h so owners can pause or withdraw before a new spender can charge; 0 disables the wait.
    /// @param scheduler Initial ROLE_SCHEDULER address (may be zero: role unset).
    /// @param mailer Initial ROLE_MAILER address (may be zero: role unset).
    constructor(address admin_, uint64 rotationDelay_, address scheduler, address mailer) {
        if (admin_ == address(0)) revert InvalidAdmin();
        if (scheduler != address(0) && scheduler == mailer) revert SpenderHasRole(ROLE_SCHEDULER);
        admin = admin_;
        rotationDelay = rotationDelay_;
        if (scheduler != address(0)) _setSpender(ROLE_SCHEDULER, scheduler);
        if (mailer != address(0)) _setSpender(ROLE_MAILER, mailer);
    }

    // ---------------------------------------------------------------- owner

    /// @notice Create the pool for `uptimeId`, lock `msg.value` in it, and grant allowances.
    /// @dev The caller becomes the owner. Reverts if the id is taken: pick a random id off-chain,
    /// and have the backend check `owner` before it schedules anything against a pool.
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
        pool.balance = msg.value;
        totalBalance += msg.value;
        _record(uptimeId, 1, 0, msg.value, address(0), 0);
        emit PoolCreated(uptimeId, msg.sender, msg.value);

        for (uint256 i; i < roles.length; ++i) {
            _setAllowance(uptimeId, roles[i], terms[i]);
        }
    }

    /// @notice Add GEN to your pool. Owner only, so nobody can mix funds into someone else's pool.
    function topUp(bytes32 uptimeId) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        Pool storage pool = _ownedPool(uptimeId);
        pool.balance += msg.value;
        totalBalance += msg.value;
        _record(uptimeId, 2, 0, msg.value, address(0), 0);
        emit ToppedUp(uptimeId, msg.value);
    }

    /// @notice Withdraw to the owner, immediately. Works while paused. `ALL` takes everything.
    function withdraw(bytes32 uptimeId, uint256 amount) external nonReentrant returns (uint256) {
        return _withdraw(uptimeId, amount, payable(msg.sender));
    }

    /// @notice Withdraw to `recipient`, immediately. Owner only.
    /// @dev A failed transfer reverts the whole call and leaves the balance in the pool. Never name a
    /// contract that credits its sender (e.g. a wrapped-GEN deposit): it would credit this contract.
    function withdrawTo(bytes32 uptimeId, uint256 amount, address payable recipient)
        external
        nonReentrant
        returns (uint256)
    {
        if (recipient == address(0)) revert InvalidRecipient();
        return _withdraw(uptimeId, amount, recipient);
    }

    /// @notice The kill switch: a paused pool refuses every charge from every spender.
    function setPaused(bytes32 uptimeId, bool paused) external nonReentrant {
        Pool storage pool = _ownedPool(uptimeId);
        pool.paused = paused;
        _record(uptimeId, paused ? 5 : 6, 0, 0, address(0), 0);
        emit PoolPaused(uptimeId, paused);
    }

    /// @notice Grant or replace a spender role's allowance. Replacing starts a fresh period count.
    function setAllowance(bytes32 uptimeId, uint8 role, Terms calldata terms) external nonReentrant {
        _ownedPool(uptimeId);
        _setAllowance(uptimeId, role, terms);
    }

    /// @notice Pause or resume one spender's allowance, keeping its terms and period count.
    function setAllowancePaused(bytes32 uptimeId, uint8 role, bool paused) external nonReentrant {
        _ownedPool(uptimeId);
        Allowance storage a = _allowances[uptimeId][role];
        if (!a.active) revert InvalidRole();
        a.paused = paused;
        _record(uptimeId, paused ? 9 : 10, role, 0, address(0), 0);
        emit AllowancePaused(uptimeId, role, paused);
    }

    /// @notice Revoke one spender's allowance entirely.
    function revokeAllowance(bytes32 uptimeId, uint8 role) external nonReentrant {
        _ownedPool(uptimeId);
        if (!_allowances[uptimeId][role].active) revert InvalidRole();
        delete _allowances[uptimeId][role];
        _record(uptimeId, 8, role, 0, address(0), 0);
        emit AllowanceRevoked(uptimeId, role);
    }

    // ---------------------------------------------------------------- spenders

    /// @notice Draw `amounts[i]` from pool `ids[i]` under the caller's role allowance, and pay the
    /// total to the caller. Each line is one run (scheduler) or one email (mailer); ids may repeat.
    /// @dev `settlementId` must be strictly greater than the role's last one (replay protection; it
    /// survives a rotation, so a new spender continues the sequence). A line that breaks any rule is
    /// SKIPPED with a `ChargeSkipped` event and moves nothing: simulate with eth_call first, read the
    /// events after. The settlement id is consumed even if every line is skipped.
    /// @return total Wei actually paid to the caller.
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

    /// @notice Propose `spender` for `role` (zero clears the role). Executable after rotationDelay.
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

    function getAllowance(bytes32 uptimeId, uint8 role)
        external
        view
        returns (Terms memory terms, uint256 spentInPeriod, uint256 lastPeriod, bool paused, bool active)
    {
        Allowance storage a = _allowances[uptimeId][role];
        return (a.terms, a.spentInPeriod, a.lastPeriod, a.paused, a.active);
    }

    /// @notice What `role` could draw from `uptimeId` right now, in one line, after every rule.
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

    /// @param offset Zero-based operation ID. Equal to total returns an empty page; greater reverts.
    /// @param limit Page size, 1 to 128.
    function getHistory(uint256 offset, uint256 limit)
        external
        view
        returns (Operation[] memory records, uint256 total)
    {
        if (limit == 0 || limit > MAX_HISTORY_PAGE) revert InvalidHistoryLimit();
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

    function _withdraw(bytes32 uptimeId, uint256 amount, address payable recipient) private returns (uint256) {
        Pool storage pool = _ownedPool(uptimeId);
        if (amount == ALL) amount = pool.balance;
        if (amount == 0) revert ZeroAmount();
        if (amount > pool.balance) revert InsufficientBalance(pool.balance, amount);

        pool.balance -= amount;
        totalBalance -= amount;
        _record(uptimeId, 3, 0, amount, recipient, 0);

        (bool sent,) = recipient.call{ value: amount }("");
        if (!sent) revert NativeTransferFailed();

        emit Withdrawn(uptimeId, recipient, amount);
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

    /// @dev Period accounting as NativeTokenPeriodTransferEnforcer: periods are fixed windows of
    /// periodDuration from startDate; unspent allowance does not carry over.
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

    // No receive/fallback: plain transfers and unknown selectors are rejected.
}
