"use client";

import { Button } from "@/components/ui";

// SLOT: the auth workstream replaces this component's body with the real
// sign-in (wallet connect / session) and its signed-in state. The header
// renders <SignInButton /> and nothing else, so keep the export name.
export function SignInButton() {
  return (
    <Button variant="secondary" size="sm" disabled title="Sign-in is coming soon">
      Sign in
    </Button>
  );
}
