# Build and reinstall the local macOS fork

Use this procedure when the owner asks to rebuild, reinstall, or restart the locally built T3 Code
desktop app. It produces the complete Electron application, including the web client, server,
native dependencies, and resource monitor.

This checkout installs the Apple Silicon Alpha product at:

```text
/Applications/T3 Code (Alpha).app
```

## Do not use the development runtime

`pnpm build:desktop` only builds source artifacts. It does not produce an installable application.
Likewise, `apps/desktop/.electron-runtime/T3 Code (Alpha).app` is the cached Electron development
runtime, not the application to copy into `/Applications`.

For a real local reinstall, build the arm64 DMG with `dist:desktop:dmg:arm64`, mount that DMG, and
copy its app bundle.

## 1. Confirm the source revision

Run from the repository root:

```sh
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Do not silently discard a dirty worktree. If the owner asked to push, push and verify the exact
remote revision separately:

```sh
git push origin main
git ls-remote origin refs/heads/main
```

The remote hash must match `git rev-parse HEAD`. Building and pushing are independent operations;
one does not imply the other.

## 2. Install dependencies without rewriting them

```sh
pnpm install --frozen-lockfile
```

If this reports an outdated lockfile, stop and investigate the manifest/lockfile mismatch. Do not
hide it by regenerating the lockfile during a reinstall unless that dependency change is intended.

## 3. Select the working Rust toolchain

The packaging script builds the native resource monitor and checks both Cargo and the requested
Rust target. On this machine, Homebrew's `rustc` may be ahead of a removed Homebrew LLVM library,
even while the rustup toolchain is healthy. A bare `cargo --version` is not sufficient because
Cargo can run while `rustc` cannot.

Verify rustup's compiler and target:

```sh
rustup which rustc
"$(rustup which rustc)" --version
"$(rustup which rustc)" --print target-libdir --target aarch64-apple-darwin
```

Always put the rustup toolchain first for the build:

```sh
rust_toolchain_bin="$(dirname "$(rustup which rustc)")"
PATH="$rust_toolchain_bin:$PATH" rustc --version
PATH="$rust_toolchain_bin:$PATH" cargo --version
```

If rustup itself reports that the target is missing, install only that target:

```sh
rustup target add aarch64-apple-darwin
```

## 4. Build the packaged app

```sh
rust_toolchain_bin="$(dirname "$(rustup which rustc)")"
PATH="$rust_toolchain_bin:$PATH" pnpm dist:desktop:dmg:arm64
```

A successful build prints its artifacts and creates, among other update files:

```text
release/T3-Code-<version>-arm64.dmg
```

Resolve and validate the expected artifact instead of selecting an arbitrary old DMG:

```sh
app_version="$(node -p "require('./apps/desktop/package.json').version")"
dmg_path="release/T3-Code-${app_version}-arm64.dmg"
test -f "$dmg_path"
hdiutil verify "$dmg_path"
```

Local builds are unsigned/ad-hoc builds. A strict `codesign --verify --deep --strict` check can
report that the bundle has no sealed resources; the previous local Alpha install behaves the same
way. The useful local checks are a successful artifact build, DMG verification, correct bundle
version and architecture, and a successful launch. Signed/notarized builds use the release
credentials and are a different workflow.

## 5. Stage the new application

Mount the exact DMG and copy its app to a temporary, explicit path in `/Applications` before
stopping the running app:

```sh
app_version="$(node -p "require('./apps/desktop/package.json').version")"
commit_short="$(git rev-parse --short=12 HEAD)"
dmg_path="release/T3-Code-${app_version}-arm64.dmg"
mount_path="/Volumes/T3 Code (Alpha) ${app_version} Installer"
source_app="$mount_path/T3 Code (Alpha).app"
staged_app="/Applications/T3 Code (Alpha)-new-${commit_short}.app"

test ! -e "$staged_app"
diskutil image attach --mountOptions nobrowse --readOnly "$dmg_path"
test -d "$source_app"
ditto "$source_app" "$staged_app"
```

Check the staged bundle before replacing anything:

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$staged_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$staged_app/Contents/Info.plist"
file "$staged_app/Contents/MacOS/T3 Code (Alpha)"
test -f "$staged_app/Contents/Resources/app.asar"
test -x "$staged_app/Contents/Resources/resource-monitor/t3-resource-monitor"
```

The display name must be `T3 Code (Alpha)`, the version must equal `$app_version`, and the main
executable must be arm64.

## 6. Quit, replace, and relaunch

Restarting can interrupt running agent turns. Only do this when the owner explicitly requested a
restart. Ask macOS to quit the application by bundle identifier:

```sh
osascript -e 'tell application id "com.t3tools.t3code" to quit'
```

Wait until the installed application's processes are gone. Inspecting processes is fine; do not
kill a PID discovered by a name/path pattern, and never use `pkill -f` from this repository. If the
app refuses to quit, stop and report it instead of risking the agent process that is performing the
reinstall.

Keep the previous bundle recoverable, then put the staged bundle at the installed path:

```sh
installed_app="/Applications/T3 Code (Alpha).app"
backup_app="/Users/$(id -un)/.Trash/T3 Code (Alpha)-pre-${commit_short}.app"

test -d "$installed_app"
test -d "$staged_app"
test ! -e "$backup_app"
mv "$installed_app" "$backup_app"
mv "$staged_app" "$installed_app"
diskutil eject "$mount_path"
open -a "$installed_app"
```

Do not recursively delete the installed app, the repository root, `release/`, or a broad directory.
Moving the previous explicit bundle to Trash makes rollback possible.

## 7. Verify the installed and running build

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  '/Applications/T3 Code (Alpha).app/Contents/Info.plist'

ps -axo pid=,etime=,command= | \
  rg '/Applications/T3 Code \(Alpha\)\.app/Contents/MacOS/T3 Code \(Alpha\)'

ps -axo pid=,etime=,command= | \
  rg '/Applications/T3 Code \(Alpha\)\.app/Contents/Resources/app\.asar/apps/server/dist/bin\.mjs'
```

Both the desktop process and its bundled server process should use the installed application path.
Finally confirm that the worktree is still clean and, when a push was requested, that origin still
matches:

```sh
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

## Rollback

If the new app does not launch, quit it through its bundle identifier, move the failed explicit
bundle aside, restore the exact backup from Trash, and open the restored app. Do not remove user
data: the application state under `~/Library/Application Support/t3code` is intentionally retained
across reinstalls.
