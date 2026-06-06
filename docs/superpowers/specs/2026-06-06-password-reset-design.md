# Password Reset & Change Design

## Overview

Two flows for password management:

1. **Forgot Password** — unauthenticated users request a reset link via email, then set a new password
2. **Change Password** — authenticated users change their password from settings

## Forgot Password Flow

### Pages

**`/forgot-password`**
- Email input only
- Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: '${BASE_URL}/reset-password' })`
- Always shows success message ("If an account with that email exists, we've sent a reset link") — prevents email enumeration
- Link to this page added below the password field on `/login`

**`/reset-password`**
- Destination of the reset link email (Supabase includes `type=recovery` token in URL hash)
- New password + confirm password fields
- Calls `supabase.auth.updateUser({ password })`
- On success, redirects to `/login` with a toast/banner
- If token expired/invalid, shows "link expired" message with link back to `/forgot-password`

### Server Action

`forgotPassword(formData)` in `src/lib/auth-actions.ts`:
- Extracts email from formData
- Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
- Returns success regardless of whether email exists

`resetPassword(formData)` in `src/lib/auth-actions.ts`:
- Extracts new password + confirm
- Validates passwords match, min length 8
- Calls `supabase.auth.updateUser({ password })`
- Returns error or success
- Logs `auth.password_change` audit event on success

## Change Password Flow (Logged-In Users)

### Page

**`/settings/password`**
- Current password field (for re-authentication)
- New password + confirm fields
- Calls `changePassword(formData)` server action

### Server Action

`changePassword(formData)` in `src/lib/auth-actions.ts`:
- Gets current user email via `supabase.auth.getUser()`
- Verifies current password by calling `supabase.auth.signInWithPassword({ email, password: currentPassword })` — this is the re-auth step
- If re-auth fails, returns error ("Current password is incorrect")
- Calls `supabase.auth.updateUser({ password: newPassword })`
- Logs `auth.password_change` audit event on success

### Navigation

Add "Change Password" link to the settings sidebar or user nav dropdown.

## Audit Logging

Both flows emit `auth.password_change` via `logAuditEvent()`:
- Forgot password request: no audit (no authenticated user to log)
- Password reset completion: `auth.password_change` with `{ method: "reset_link" }`
- Password change (settings): `auth.password_change` with `{ method: "settings" }`

## Security Considerations

- Supabase built-in rate limit: 1 reset email per hour per email address
- Password minimum length: 8 characters (enforced client-side and Supabase config)
- Re-authentication required for logged-in password change
- No email enumeration on forgot-password page
- Reset token validated by Supabase (URL hash, server-side)
- Reset link redirects to `/reset-password` — must be configured in Supabase dashboard under Auth > URL Configuration > Redirect URLs

## Files to Create/Modify

- `src/app/forgot-password/page.tsx` — forgot password form
- `src/app/reset-password/page.tsx` — reset password form
- `src/app/settings/password/page.tsx` — change password form
- `src/lib/auth-actions.ts` — add `forgotPassword`, `resetPassword`, `changePassword` actions
- `src/app/login/page.tsx` — add "Forgot password?" link
- `src/components/user-nav.tsx` — add "Change Password" link

## Testing

- Unit tests for all 3 server actions (mock supabase)
- Test: forgotPassword calls resetPasswordForEmail with correct redirectTo
- Test: resetPassword validates password match and min length
- Test: changePassword re-authenticates before updating
- Test: both reset and change log audit event on success
