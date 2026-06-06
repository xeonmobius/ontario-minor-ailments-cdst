export function TeamList({
  members,
  invitations,
}: {
  members: { id: string; full_name: string; email: string; role: string }[]
  invitations: { id: string; email: string; created_at: string; expires_at: string; accepted_at: string | null }[]
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-2">Team Members</h2>
        <div className="divide-y rounded-lg border">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.full_name}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <span className="text-xs bg-muted px-2 py-1 rounded capitalize">{m.role}</span>
            </div>
          ))}
          {members.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No members yet.</p>
          )}
        </div>
      </div>

      {invitations.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Pending Invitations</h2>
          <div className="divide-y rounded-lg border">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Pending</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
