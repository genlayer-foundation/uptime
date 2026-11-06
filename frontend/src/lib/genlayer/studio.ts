// Studio (studio.genlayer.com) clients use genlayer-js 1.x, aliased as
// "genlayer-js-v1" in package.json. Bradbury keeps genlayer-js 2.x.
//
// Why: genlayer-js 2.x submits EVERY network's deploy/write as the fee-aware
// addTransaction(params) (selector 0x35a251fb), including on studionet. Hosted
// Studio's ConsensusMain (sim_getConsensusContract, checked 2026-11-06) still
// exposes only the legacy addTransaction(address,address,uint256,uint256,bytes)
// (0x27241a99). Studio accepted the 2.x txs but could not decode them (stored
// data {}), so they finalized NO_MAJORITY with no contract created. 1.1.8 is
// the SDK GenLayer CLI 0.39.2 installs, whose Studio deploys work; it encodes
// 0x27241a99 with no value. Studio is free: never attach fees here.
//
// Drop this file once hosted Studio decodes the fee-aware call (the Studio
// repo's transactions_parser.py already has FEE_AWARE_ADD_TRANSACTION_ABI).

import { createAccount, createClient } from "genlayer-js-v1";
import { studionet } from "genlayer-js-v1/chains";

/** Selector hosted Studio decodes: addTransaction(address,address,uint256,uint256,bytes). */
export const STUDIO_ADD_TRANSACTION_SELECTOR = "0x27241a99";

/** A Studio client (genlayer-js 1.x shape), signed by `privateKey` when given. */
export function studioClient(privateKey?: `0x${string}`) {
  return privateKey
    ? createClient({ chain: studionet, account: createAccount(privateKey) })
    : createClient({ chain: studionet });
}

export { studionet as studioChainV1 };
