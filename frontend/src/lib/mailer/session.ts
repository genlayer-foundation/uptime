// The SIWE session the backend issues (cookie `uptime_session`, HMAC with
// SESSION_SECRET), re-exported from its one owner: lib/jobs/auth/session.ts.
// Fail closed: no SESSION_SECRET (>= 32 chars) => nobody is signed in.
export { sessionWallet } from "@/lib/jobs/auth/session";
