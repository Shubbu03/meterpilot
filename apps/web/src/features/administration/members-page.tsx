import { organizationMembershipRoleSchema } from "@meterpilot/contracts/organizations";
import { Button, EmptyState, Notice, StatusBadge, TextField } from "@meterpilot/ui";
import { UserListIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../lib/api/client";
import { queryClient } from "../../lib/query-client";
import { useAuthenticatedSession } from "../auth/auth-context";
import { useActiveOrganization } from "../organizations/organization-context";
import { addMember, adminKeys, listMembers, removeMember, updateMember } from "./api";
export function MembersPage() {
  const auth = useAuthenticatedSession();
  const organization = useActiveOrganization();
  const id = organization.active.organization.id;
  const [removeTarget, setRemoveTarget] = useState<{ id: string; email: string }>();
  const [confirmation, setConfirmation] = useState("");
  const query = useQuery({ queryFn: () => listMembers(id), queryKey: adminKeys.members(id) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.members(id) });
  const addMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: Parameters<typeof addMember>[2] }) =>
      addMember(id, email, role),
    onSuccess: refresh,
  });
  const updateMutation = useMutation({
    mutationFn: ({ role, userId }: { role: Parameters<typeof updateMember>[2]; userId: string }) =>
      updateMember(id, userId, role),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(id, userId),
    async onSuccess() {
      setRemoveTarget(undefined);
      setConfirmation("");
      await refresh();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const role = organizationMembershipRoleSchema.safeParse(data.get("role"));
    if (role.success)
      addMutation.mutate(
        { email: String(data.get("email")), role: role.data },
        { onSuccess: () => form.reset() },
      );
  }
  const error = addMutation.error ?? updateMutation.error ?? removeMutation.error;
  return (
    <div className="page-frame">
      <header className="border-mp-border border-b pb-7">
        <p className="section-kicker">Administration / Access control</p>
        <h1 className="mt-3 font-mp-display text-5xl font-semibold">Members</h1>
        <p className="mt-4 text-sm text-mp-ink-muted">
          Assign organization roles while protecting the last owner from removal or demotion.
        </p>
      </header>
      {error ? (
        <Notice className="mt-6" title="Membership operation failed" tone="danger">
          <p>
            {error instanceof ApiError
              ? `${error.message} Request ID: ${error.requestId}`
              : "The operation failed."}
          </p>
        </Notice>
      ) : null}
      <form
        className="mt-6 grid gap-4 border border-mp-border bg-mp-panel p-5 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        onSubmit={submit}
      >
        <TextField label="Member email" name="email" required type="email" />
        <label className="grid gap-1.5 text-sm font-semibold">
          Role
          <select className="min-h-11 border border-mp-border bg-mp-panel px-3" name="role">
            {organizationMembershipRoleSchema.options.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <Button loading={addMutation.isPending} loadingLabel="Adding…" type="submit">
          Add member
        </Button>
      </form>
      {query.data?.items.length === 0 ? (
        <EmptyState
          className="mt-6 border border-mp-border bg-mp-panel"
          description={<p>No membership records were returned.</p>}
          title="No members"
        />
      ) : (
        <div className="mt-6 space-y-3">
          {query.data?.items.map((member) => (
            <article
              className="grid gap-4 border border-mp-border bg-mp-panel p-4 sm:grid-cols-[auto_1fr_12rem_auto] sm:items-center"
              key={member.user.id}
            >
              <UserListIcon aria-hidden="true" size={22} />
              <div>
                <p className="font-semibold">
                  {member.user.name}
                  {member.user.id === auth.session.user.id ? " (you)" : ""}
                </p>
                <p className="text-xs text-mp-ink-muted">{member.user.email}</p>
              </div>
              <select
                aria-label={`Role for ${member.user.email}`}
                className="min-h-11 border border-mp-border bg-mp-panel px-3 text-sm"
                defaultValue={member.role}
                onChange={(event) => {
                  const role = organizationMembershipRoleSchema.parse(event.currentTarget.value);
                  updateMutation.mutate({ role, userId: member.user.id });
                }}
              >
                {organizationMembershipRoleSchema.options.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <StatusBadge tone={member.role === "owner" ? "info" : "neutral"}>
                  {member.role}
                </StatusBadge>
                {member.user.id !== auth.session.user.id ? (
                  <Button
                    onClick={() => {
                      setRemoveTarget({ email: member.user.email, id: member.user.id });
                      setConfirmation("");
                    }}
                    size="compact"
                    variant="danger"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      {removeTarget ? (
        <section className="fixed inset-0 z-50 grid place-items-center bg-mp-ink/70 p-4">
          <div className="w-full max-w-lg border border-mp-border bg-mp-panel p-6">
            <h2 className="font-mp-display text-3xl font-semibold">Remove member?</h2>
            <p className="mt-3 text-sm">Type {removeTarget.email} to confirm access removal.</p>
            <TextField
              className="mt-5"
              label="Email confirmation"
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              value={confirmation}
            />
            <div className="mt-5 flex justify-end gap-3">
              <Button onClick={() => setRemoveTarget(undefined)} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={confirmation !== removeTarget.email}
                onClick={() => removeMutation.mutate(removeTarget.id)}
                variant="danger"
              >
                Remove member
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
