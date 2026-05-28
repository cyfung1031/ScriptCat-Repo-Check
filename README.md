# ScriptCat Branch Flow

A static visualization tool for comparing ScriptCat's `main` 1.3.x stable branch with the `release/v1.4` 1.4.x beta branch.

Open `index.html` through a local web server or publish the repository with GitHub Pages. The page loads the latest saved snapshot from `data/branch-flow.json`; it does not call the GitHub API from the browser.

## What It Shows

- **Stable commits also in beta**: recent `main` commits that are already reachable from `release/v1.4`.
- **Stable commits not in beta**: commits reachable from `main` but not reachable from `release/v1.4`.
- **Beta commits not in stable**: commits in the loaded `release/v1.4` history that are not reachable from `main`.
- **Merge base**: the common ancestor GitHub reports for the branch comparison.

The default repository is `scriptscat/scriptcat`, with `main` compared against `release/v1.4`.
The beta branch history is fetched newest-first through the configured stop marker, which defaults to `Merge branch 'main' into release/v1.3`, plus a small previous-cycle context window. Commits at and older than that marker are labeled with the previous beta branch inferred from the marker, such as `1.3 beta`.

## Updating Data

The GitHub Actions workflow in `.github/workflows/update-branch-flow-data.yml` refreshes `data/branch-flow.json` on a schedule and can also be run manually from the Actions tab. The workflow uses the repository `GITHUB_TOKEN`, fetches GitHub API data server-side, commits the JSON snapshot only when it changed, and pushes it back to the repo.

For a one-off local refresh, run:

```sh
node scripts/update-branch-flow-data.mjs
```

Optional environment variables:

- `TARGET_REPO` defaults to `scriptscat/scriptcat`.
- `MAIN_BRANCH` defaults to `main`.
- `RELEASE_BRANCH` defaults to `release/v1.4`.
- `MAIN_LIMIT` defaults to `160`.
- `BETA_STOP_MARKER` defaults to `Merge branch 'main' into release/v1.3`.
- `GITHUB_TOKEN` raises API limits for the server-side fetch.

## Notes

This follows Git ancestry. Git commit objects do not permanently record the branch name where they were created, so track labels are inferred from reachability and position in the loaded branch history. If a commit was cherry-picked or squashed into the beta branch, GitHub will usually show it as a different commit unless the original commit SHA is actually reachable from that branch.

The browser intentionally avoids live GitHub API access, so repeated page refreshes do not spend GitHub API rate limit.
