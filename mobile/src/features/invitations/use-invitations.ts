import type { Invitation, UserSummary } from "@music-room/shared";
import { useEffect, useState } from "react";
import { isRequestError } from "@/api/api-error";
import { invitationsApi, type InvitableResource } from "./invitations-api";
import {
  invitedIds,
  withInvitation,
  withNextPage,
  withoutInvitee,
} from "./invitation-list";
import { invitationErrorMessage } from "./messages";

/** The owner's invited list for one event or playlist: load, invite, remove. Server first, always. */
export function useInvitations(resource: InvitableResource, id: string) {
  const [api] = useState(() => invitationsApi(resource, id));
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .list()
      .then(
        (page) => {
          if (!active) return;
          setInvitations(page.items);
          setNextCursor(page.nextCursor);
        },
        (error: unknown) => {
          if (active) setLoadError(invitationErrorMessage(error));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    try {
      const page = await api.list(nextCursor);
      setInvitations((list) => withNextPage(list, page.items));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setActionError(invitationErrorMessage(error));
    }
  }

  async function invite(user: UserSummary): Promise<void> {
    setBusyUserId(user.id);
    setActionError(null);
    try {
      const invitation = await api.invite(user.id);
      setInvitations((list) => withInvitation(list, invitation));
    } catch (error) {
      if (isRequestError(error) && error.code === "ALREADY_INVITED") {
        // Invited meanwhile (another device): the list was stale, so read it again.
        const page = await api.list().catch(() => null);
        if (page) setInvitations(page.items);
      } else {
        setActionError(invitationErrorMessage(error));
      }
    } finally {
      setBusyUserId(null);
    }
  }

  async function remove(userId: string): Promise<void> {
    setBusyUserId(userId);
    setActionError(null);
    try {
      await api.remove(userId);
      setInvitations((list) => withoutInvitee(list, userId));
    } catch (error) {
      setActionError(invitationErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  }

  return {
    invitations,
    invited: invitedIds(invitations),
    hasMore: nextCursor !== null,
    loading,
    loadError,
    actionError,
    busyUserId,
    loadMore,
    invite,
    remove,
  };
}
