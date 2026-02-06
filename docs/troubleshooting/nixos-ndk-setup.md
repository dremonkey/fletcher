To get the Flutter app running on the emulator, follow these steps to clear the NixOS/Android hurdles.

> **Using direnv?** If you have direnv + nix-direnv configured, the environment activates automatically when you `cd` into the project. You can skip `nix develop` and `nix develop --command` prefixes throughout this guide. After flake.nix changes, run `direnv reload` or re-enter the directory.

### 0. Enable nix-ld (Required)

Gradle downloads pre-compiled binaries (like `aapt2`) that expect a traditional Linux filesystem. On NixOS, these fail because `/lib64/ld-linux-x86-64.so.2` doesn't exist. **nix-ld** provides a compatibility shim that makes these binaries work.

Add this to your NixOS configuration (`/etc/nixos/configuration.nix` or your flake):

```nix
programs.nix-ld.enable = true;
```

Then rebuild:

```bash
sudo nixos-rebuild switch
```

**Why nix-ld?** It's lightweight (just a stub at `/lib64/`) and fixes this class of problem system-wide — useful for Android development, VS Code extensions, and other tools that download binaries at runtime.

| Alternative | Trade-off |
|-------------|-----------|
| FHS wrapper | Per-project, heavier setup |
| steam-run | Full chroot, overkill |
| patchelf | Manual patching per binary, fragile |

### 1. Update the Environment
Since I just modified the `flake.nix` to include the correct NDK version, you need to force Nix to rebuild the environment.

```bash
cd ~/code/fletcher
# This will download the specific NDK version (can take a minute)
nix develop
```

### 2. Verify the Android Licenses
The `flake.nix` includes `android_sdk.accept_license = true`, which pre-accepts licenses during the Nix build. However because Flutter's license check doesn't recognize Nix's pre-accepted licenses, you will need to manually run the license command. You usually only need to do this once.

```bash
nix develop --command flutter doctor --android-licenses
```
**Action:** Press **'y'** for every prompt until it finishes.

### 3. Start the Emulator
We need to launch the Pixel 9 emulator we manually configured. Open a **new terminal tab** for this so it can stay running:

```bash
cd ~/code/fletcher
nix develop --command emulator -avd pixel_9
```
*Wait until the emulator fully boots to the home screen.*

### 4. Run the Fletcher App
Now, back in your primary terminal, deploy the app to the running emulator:

```bash
cd ~/code/fletcher/apps/mobile
nix develop ../../ --command flutter run -d emulator-5554
```

---

### If you hit an error:
*   **"Could not start dynamically linked executable" / aapt2 daemon failed:** You need to enable `programs.nix-ld.enable = true` in your NixOS configuration. See Step 0 above.
*   **"Failed to install SDK components" (CMake, build-tools, etc.):** Add the missing component to `flake.nix` in `composeAndroidPackages`. Gradle cannot download into the read-only Nix store.
*   **"NDK not found":** Run `flutter config --android-ndk $ANDROID_NDK_HOME` to point Flutter to the Nix-provided NDK.
*   **"No devices found":** Run `adb devices` to make sure the emulator is listed.

Once the app launches on the emulator, you're ready for development with hot reload (`r` to reload, `R` to restart).
