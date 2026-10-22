# Controlled administrator account recovery

This procedure is for a verified production administrator account that cannot sign in. It does not create users, enable disabled accounts, or print the new password.

## Preconditions

- Confirm the exact administrator username and that the account should remain enabled.
- Use an approved workstation with the Railway CLI authenticated to the EWASCO project.
- Confirm the selected Railway service and environment are `ewasco-cheminventory` and `production`.
- Run the same script against a dedicated test database first.
- Do not put the password in source code, commit messages, tickets, or chat.

## One-time operation

From a trusted local checkout of this branch, in the `server` directory, set `RESET_ADMIN_USERNAME` to the exact target username, `RECOVERY_NEW_PASSWORD` to a newly generated unique password of at least 12 characters, and `CONFIRM_ADMIN_PASSWORD_RESET` to `RESET` in the local shell environment. Then run the script through the authenticated Railway environment so `DATABASE_URL` comes from the selected service:

```bash
railway run --service ewasco-cheminventory --environment production node src/reset-admin-password.js
```

Review the Railway CLI's selected project and environment before running. Do not enable or modify `SEED_ADMIN`; this procedure does not depend on the startup seeder. Keep the new password in a trusted password manager and do not echo it in the terminal or shell history. Clear the three temporary recovery environment variables immediately after the operation.

The script only proceeds when the explicit confirmation is present and exactly one enabled `Administrator` account matches the username. It hashes the password with bcrypt, resets failed-login/lockout fields, revokes that account's existing sessions, writes an audit record, and commits all changes transactionally. If the account is missing, ambiguous, or disabled, it exits without changing the account. Disabled-account recovery requires a separate authorised decision and must not be bypassed by this script.

## Verify

1. Confirm the command reports completion without printing a password.
2. Sign in through the actual production URL using the exact username and new password.
3. Verify `/api/auth/me` returns the authenticated user after login and after a page refresh.
4. Verify the previous session is no longer valid.
5. Clear temporary recovery variables and record the change through the organisation's approved change-control process.

Do not claim production login is restored until a real login and session have been tested. This CLI procedure has not run merely because the script exists in the repository.
