# Secure the runs in flight

Read by `/sdlc:pause` when the session launched a workflow or a background agent that has not finished.

A workflow run or a background agent dies with its session, and `resumeFromRunId` works only inside that session.
Only git, the tracker and the installed plugins reach the next session or the next machine, so pausing a run means leaving its state rebuildable from those three.

1. **List the runs.** For each workflow or background agent this session launched and has not seen finish, record:
   - the task id
   - the script path and its exact `args`, or the agent's one-line purpose
   - the branch it writes

   Then run `git worktree list` for every worktree a run writes, including per-ticket worktrees.
2. **Stop or wait, per run.**
   - Let a run finish if it is about to reach a boundary: an open pull request, or a ticket's `BUILT:` comment.
   - Otherwise stop it with `TaskStop`.
   - Never stop a run halfway through integrating without checking its worktree afterwards.
3. **Make every branch travel.**
   - Commit each worktree's uncommitted work on its own branch as `WIP: #N <step reached>`. Ask once for the whole set.
   - Push every batch and ticket branch with `git push -u origin <branch>`. A branch that exists only here does not exist on the next machine.
   - Never push to the default branch.
4. **Check the relaunch can run elsewhere.**
   - A workflow script is committed and pushed to a repository the next machine has first, or the relaunch is a dead link.
5. **Leave no orphans.** Remove only the worktrees whose branches are merged. Keep the rest: a later session on this machine continues in them.
