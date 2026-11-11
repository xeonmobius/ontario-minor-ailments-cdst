/**
 * The shape every auth/settings server action returns through useActionState.
 * Import this instead of casting `(state as any)` in client forms.
 */
export interface ActionState {
  error?: string
  success?: boolean
}
