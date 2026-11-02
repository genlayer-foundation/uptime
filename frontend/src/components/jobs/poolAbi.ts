// UptimePool ABI subset used by the jobs UI (owner functions + views + errors).
// Generated from the forge build of contracts/evm/src/UptimePool.sol
// (contracts/evm/out/UptimePool.sol/UptimePool.json). Re-extract when the contract changes.
export const UPTIME_POOL_ABI = [
  {
    "type": "function",
    "name": "ALL",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "available",
    "inputs": [
      {
        "name": "uptimeId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "role",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "uptimeId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "roles",
        "type": "uint8[]",
        "internalType": "uint8[]"
      },
      {
        "name": "terms",
        "type": "tuple[]",
        "internalType": "struct UptimePool.Terms[]",
        "components": [
          {
            "name": "periodAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "periodDuration",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "startDate",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "maxPerCharge",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "getAllowance",
    "inputs": [
      {
        "name": "uptimeId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "role",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "terms",
        "type": "tuple",
        "internalType": "struct UptimePool.Terms",
        "components": [
          {
            "name": "periodAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "periodDuration",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "startDate",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "maxPerCharge",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "name": "spentInPeriod",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lastPeriod",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "paused",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPool",
    "inputs": [
      {
        "name": "uptimeId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "paused",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "uptimeId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "paused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "topUp",
    "inputs": [
      {
        "name": "uptimeId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "uptimeId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "error",
    "name": "InsufficientBalance",
    "inputs": [
      {
        "name": "available",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "requested",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAdmin",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidHistoryLimit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidHistoryOffset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRecipient",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRole",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTerms",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidUptimeId",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LengthMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NativeTransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPendingSpender",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAdmin",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPoolOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotSpender",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PoolExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RotationNotReady",
    "inputs": [
      {
        "name": "eta",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "SettlementReplayed",
    "inputs": [
      {
        "name": "last",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "given",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "SpenderHasRole",
    "inputs": [
      {
        "name": "role",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownPool",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;

export const ROLE_SCHEDULER = 1;
export const ROLE_MAILER = 2;
