# Bug Fix: AuthGuard.tsx — Rules of Hooks violation

## Symptom

After successful sign-in (verified working via GitHub OAuth), the dashboard route crashes with two errors:

1. **Console Error**: "React has detected a change in the order of Hooks called by `AuthGuardWithPrivy`. Previous render: `useState`. Next render: `useContext`."
2. **Runtime Error**: `Cannot read properties of null (reading '1')` at `src/components/AuthGuard.tsx` line 12, column 36.

Confirmed from 5 screenshots showing the same error across multiple page navigations.

## Root cause

`src/components/AuthGuard.tsx` is using `require("@privy-io/react-auth")` inside the component body instead of a proper ES module import at the top of the file. The `require()` returns undefined during SSR/hydration, then destructuring `usePrivy()` throws null. This also violates the Rules of Hooks because the call site is conditional on whether the require resolved.

Visible offending lines (currently at line 10-12):
```tsx
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { usePrivy } = require("@privy-io/react-auth");
const { ready, authenticated } = usePrivy();
```

## Fix

Refactor `src/components/AuthGuard.tsx` properly:

1. Add `'use client'` directive at the very top of the file (line 1).
2. Remove the `require()` call entirely.
3. Use a standard ES import at the top of the file:
   ```tsx
   import { usePrivy } from '@privy-io/react-auth';
   ```
4. Import the guest auth state from the existing Zustand store at `src/lib/guest.ts` so guest sessions are recognized and not incorrectly redirected.
5. Handle the not-ready state properly: while `ready === false`, render a simple loading indicator (or `null`) instead of running auth checks or redirects.
6. Only redirect to `/sign-in` when **all** of these are true:
   - `ready === true`
   - `authenticated === false` (Privy says not logged in)
   - No valid guest session exists in the Zustand store
7. Export the component as the default React component that wraps `children`.

## Constraints

- **Only touch `src/components/AuthGuard.tsx`.** Do not refactor any other file.
- **Do not add new dependencies.**
- **Do not change the export name or signature** — anywhere else in the app that imports `<AuthGuard>` must keep working without edits.

## Verification

After applying the fix:

1. Kill the dev server (`Ctrl+C` in the terminal running `npm run dev`).
2. Restart it: `npm run dev`.
3. Hard refresh the browser at `http://localhost:3000` (`Ctrl+Shift+R`).
4. Test these flows:
   - Click **Sign In** → **Continue with GitHub** → authorize → should land on `/dashboard` with no console or runtime errors.
   - From `/dashboard`, navigate to one of the game pages (e.g. `/prompt-wars`) — should load the placeholder, no errors.
   - Sign out, then in a new tab try to visit `http://localhost:3000/dashboard` directly — should redirect to `/sign-in`.
   - Sign in as **guest** with a username → should land on `/dashboard`, no errors.

All four checks must pass.

## Commit

When fix is verified, commit with message:
```
fix(auth): replace require() with proper import in AuthGuard, resolve hooks order violation
```

Then report back: "AuthGuard fix complete, all 4 verification flows pass."
