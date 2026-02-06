# NixOS Setup Guide

This guide covers NixOS-specific configuration for Fletcher development.

> **Using direnv?** If you have direnv + nix-direnv configured, the environment activates automatically when you `cd` into the project. You can skip `nix develop` prefixes throughout this guide. After `flake.nix` changes, run `direnv reload` or re-enter the directory.

## System Configuration

### 1. Enable nix-ld (Required)

Gradle downloads pre-compiled binaries (like `aapt2`) that expect a traditional Linux filesystem. On NixOS, these fail because `/lib64/ld-linux-x86-64.so.2` doesn't exist. **nix-ld** provides a compatibility shim that makes these binaries work.

Add this to your NixOS configuration:

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

### 2. Enable Docker and KVM

Add to your `configuration.nix` (flake or traditional):

```nix
{ config, pkgs, ... }:

{
  # Docker for LiveKit server
  virtualisation.docker.enable = true;

  # KVM for Android emulator hardware acceleration
  boot.kernelModules = [ "kvm-intel" ];  # Use "kvm-amd" for AMD CPUs

  # Add your user to required groups
  users.users.<your-username>.extraGroups = [
    "docker"  # Run docker without sudo
    "kvm"     # Android emulator hardware acceleration
  ];
}
```

Then rebuild and reboot:

```bash
# With flakes
sudo nixos-rebuild switch --flake .#<your-hostname>

# Without flakes
sudo nixos-rebuild switch

reboot
```

### 3. Verify System Setup

After rebooting:

```bash
# Check Docker
docker run hello-world

# Check KVM is available
ls -la /dev/kvm

# Check group membership
groups | grep -E "(docker|kvm)"
```

## Development Environment

The project uses a Nix flake to provide all development dependencies.

### First-Time Setup

```bash
cd fletcher
direnv allow  # If using direnv
# OR
nix develop   # Manual shell
```

The first load downloads Flutter, Android SDK, and other dependencies. Subsequent loads are instant due to caching.

### Android Licenses

The `flake.nix` includes `android_sdk.accept_license = true`, which pre-accepts licenses during the Nix build. However, Flutter's license check doesn't recognize Nix's pre-accepted licenses, so you need to run this once:

```bash
flutter doctor --android-licenses
```

Press **'y'** for every prompt until it finishes.

**When to re-run licenses:**
- After adding new SDK components to `flake.nix` (new platform versions, build tools, etc.)
- After major Android SDK updates in nixpkgs
- If you see "Android license status unknown" errors

You generally don't need to re-run for minor nixpkgs updates or when the SDK version stays the same.

## Android Emulator

### Create an AVD

The `avdmanager` tool has compatibility issues with JDK 17 (JAXB was removed). Create the AVD manually:

```bash
# Create AVD directories
mkdir -p ~/.android/avd/pixel_9.avd

# Create the AVD pointer file
cat > ~/.android/avd/pixel_9.ini << 'EOF'
avd.ini.encoding=UTF-8
path=/home/$USER/.android/avd/pixel_9.avd
path.rel=avd/pixel_9.avd
target=android-36
EOF

# Create the AVD config (Pixel 9 with API 36)
cat > ~/.android/avd/pixel_9.avd/config.ini << 'EOF'
AvdId=pixel_9
PlayStore.enabled=true
abi.type=x86_64
avd.ini.displayname=Pixel 9 API 36
avd.ini.encoding=UTF-8
disk.dataPartition.size=6442450944
hw.accelerometer=yes
hw.audioInput=yes
hw.battery=yes
hw.camera.back=virtualscene
hw.camera.front=emulated
hw.cpu.arch=x86_64
hw.cpu.ncore=4
hw.device.manufacturer=Google
hw.device.name=pixel_9
hw.gps=yes
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.keyboard=yes
hw.lcd.density=420
hw.lcd.height=2424
hw.lcd.width=1080
hw.ramSize=2048
hw.sdCard=yes
hw.sensors.orientation=yes
hw.sensors.proximity=yes
image.sysdir.1=system-images/android-36/google_apis_playstore/x86_64/
sdcard.size=512M
showDeviceFrame=no
skin.dynamic=yes
skin.name=1080x2424
skin.path=_no_skin
tag.display=Google Play
tag.id=google_apis_playstore
vm.heapSize=256
EOF

# Fix the path in the ini file (replace $USER with actual username)
sed -i "s|\$USER|$USER|g" ~/.android/avd/pixel_9.ini
```

Verify the AVD was created:

```bash
emulator -list-avds
# Should output: pixel_9
```

### Run the Emulator

```bash
# Standard
emulator -avd pixel_9

# Headless for CI/testing
emulator -avd pixel_9 -no-window -no-audio -no-boot-anim
```

With KVM enabled, the emulator should show "Fast Virtualization" in the title bar or startup logs.

### Run the Flutter App

Once the emulator is running:

```bash
cd apps/mobile
flutter run -d emulator-5554
```

Or use the convenience script that handles everything:

```bash
bun run mobile:dev
```

Once the app launches, you're ready for development with hot reload (`r` to reload, `R` to restart).

## Troubleshooting

### "Could not start dynamically linked executable" / aapt2 daemon failed

You need to enable `programs.nix-ld.enable = true` in your NixOS configuration. See System Configuration above.

### "Failed to install SDK components" (CMake, build-tools, etc.)

Gradle cannot download into the read-only Nix store. Add the missing component to `flake.nix` in `composeAndroidPackages`:

```nix
androidComposition = pkgs.androidenv.composeAndroidPackages {
  buildToolsVersions = [ "34.0.0" "35.0.0" ];  # Add version here
  cmakeVersions = [ "3.22.1" ];                 # Add CMake versions
  # ...
};
```

### "NDK not found"

Point Flutter to the Nix-provided NDK:

```bash
flutter config --android-ndk $ANDROID_NDK_HOME
```

### "No devices found"

Check the emulator is listed:

```bash
adb devices
```

### "Permission denied" on /dev/kvm

You're not in the `kvm` group:

```bash
groups | grep kvm  # Should show kvm
```

If not, verify your `configuration.nix` includes the group and rebuild.

### Emulator is slow (no hardware acceleration)

1. Check if your CPU supports virtualization (Intel VT-x or AMD-V)
2. Ensure virtualization is enabled in BIOS/UEFI
3. Verify the correct kernel module is loaded:
   ```bash
   lsmod | grep kvm
   ```
   Should show `kvm_intel` or `kvm_amd`.

### Android SDK license error in Nix

The flake already includes `android_sdk.accept_license = true`. If you still see errors, clear the direnv cache:

```bash
rm -rf .direnv && direnv allow
```

### avdmanager "NoClassDefFoundError: javax/xml/bind"

This is a known issue with JDK 17+ where JAXB was removed. Use the manual AVD creation method described above instead of `avdmanager`.

### Virtual Device Manager disabled in Android Studio

Android Studio needs a project open first. Either:
1. Open `apps/mobile` in Android Studio, then Device Manager will be enabled
2. Use the command line to create AVDs (recommended on NixOS)
