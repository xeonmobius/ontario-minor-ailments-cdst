"use client"

import Link from "next/link"
import { LogOut, Settings, User, Users } from "lucide-react"
import { logout } from "@/lib/auth-actions"
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
  const isOwner = profile.role === "owner"

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
            <form action={logout}>
              <DialogClose render={<Button variant="outline" className="w-full" />}>
                <LogOut className="size-4 mr-2" />
                Sign out
              </DialogClose>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
