"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { LogOut, Settings, User, Users, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import type { Profile } from "@/types"

export function UserNav({ profile }: { profile: Profile }) {
  const isOwner = profile.activeRole === "owner"
  const router = useRouter()

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground hidden sm:inline">
        {profile.fullName}
      </span>
      <Dialog>
        <DialogTrigger
          render={
            <Button variant="outline" size="icon" aria-label="User menu" />
          }
        >
          <User className="size-4" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{profile.fullName}</DialogTitle>
          </DialogHeader>
          <nav className="flex flex-col gap-1">
            <Link
              href="/settings/profile"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              <Settings className="size-4" />
              Profile Settings
            </Link>
            <Link
              href="/settings/password"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              <KeyRound className="size-4" />
              Change Password
            </Link>
            {isOwner && (
              <>
                <Link
                  href="/settings/pharmacy"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <Settings className="size-4" />
                  Pharmacy Settings
                </Link>
                <Link
                  href="/settings/team"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <Users className="size-4" />
                  Manage Team
                </Link>
              </>
            )}
          </nav>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" className="w-full" onClick={handleLogout} />
              }
            >
              <LogOut className="size-4 mr-2" />
              Sign out
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}