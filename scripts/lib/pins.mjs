// A consumer points at kyber twice, and the two can drift.
//
// The submodule gitlink says which commit of the SCRIPTS runs. A
// `uses: criscardozo/kyber/.github/workflows/...@<ref>` in a workflow says
// which commit of the WORKFLOW runs, and GitHub resolves that from the
// repository, not from the checked-out submodule. Bump one and forget the
// other and the job is a workflow from one commit driving scripts from
// another — which usually works, right up until it does not, and nothing in
// the run output says the two differ.

const USES = /uses:\s*criscardozo\/kyber\/([^\s@]+)@([^\s"']+)/g;

/** Every kyber ref a workflow file pins, as `{ path, ref }`. */
export function kyberPins(text) {
  return [...text.matchAll(USES)].map((m) => ({ path: m[1], ref: m[2] }));
}

/**
 * Which pins disagree with the gitlink.
 *
 * A branch or tag is refused outright rather than compared: `@main` silently
 * changes what runs when kyber changes, which is the opposite of what the
 * gitlink is for.
 */
export function pinProblems(pins, gitlink) {
  const problems = [];
  for (const { file, path, ref } of pins) {
    const where = file === undefined ? path : `${file} (${path})`;
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      problems.push(
        `${where} is pinned to "${ref}", which is not a full commit sha — ` +
          "a branch or tag changes what runs without a commit here",
      );
    } else if (ref !== gitlink) {
      problems.push(
        `${where} is pinned to ${ref.slice(0, 7)} but the submodule is at ` +
          `${gitlink.slice(0, 7)} — the workflow and the scripts come from different commits`,
      );
    }
  }
  return problems;
}

/**
 * The gitlink `git ls-files -s kyber` reports: the sha that WILL be committed.
 *
 * Not `HEAD:kyber`, which is the sha that already was. Bumping the submodule
 * and the workflow together means staging a new gitlink while the workflow
 * file is edited in the working tree, and comparing the new pin against the
 * old gitlink calls that a mismatch — a guard that goes red in the middle of
 * the exact operation it exists to keep honest is one that gets an exception
 * bolted on. Reported by a consumer that saw it red and pushed anyway.
 *
 * And not the submodule's own checked-out HEAD either, which was the other
 * candidate: that is where the scripts are RIGHT NOW, but it is satisfied by a
 * submodule someone moved and never staged, which is the case the guard should
 * still catch. The index is what the commit is going to say.
 */
export function gitlinkFromIndex(lsFilesOutput) {
  const line = lsFilesOutput.split("\n").find((l) => /^160000 [0-9a-f]{40} /.test(l));
  if (line === undefined) return null;
  return line.split(/\s+/)[1];
}
