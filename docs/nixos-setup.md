# NixOS Setup Guide

This guide covers NixOS-specific configuration for Fletcher development.

## System Configuration

### With Flakes

If you're using a flake-based NixOS configuration, add to your `configuration.nix` module:

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
sudo nixos-rebuild switch --flake .#<your-hostname>
reboot
```

### Without Flakes

Add the same configuration to your `/etc/nixos/configuration.nix`:

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
sudo nixos-rebuild switch
reboot
```

## Verify Setup

After rebooting, verify everything is configured correctly:

```bash
# Check Docker
docker run hello-world

# Check KVM is available
ls -la /dev/kvm

# Check group membership
groups | grep -E "(docker|kvm)"
```

## Development Environment

The project uses a Nix flake to provide all development dependencies. With `nix-direnv` configured, the environment loads automatically when you enter the directory.

### First-Time Setup

```bash
cd fletcher
direnv allow
```

The first load will download Flutter, Android SDK, and other dependencies. Subsequent loads are instant due to caching.

### Manual Shell (without direnv)

```bash
nix develop
```

## Android Emulator

### Create an AVD

The `avdmanager` tool has compatibility issues with JDK 17 (JAXB was removed). Create the AVD manually instead:

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
emulator -avd pixel_9
```

Or run headless for CI/testing:

```bash
emulator -avd pixel_9 -no-window -no-audio -no-boot-anim
```

With KVM enabled, the emulator should show "Fast Virtualization" in the title bar or startup logs.

## Troubleshooting

### "Permission denied" on /dev/kvm

You're not in the `kvm` group. Add yourself and log out/in:

```bash
groups | grep kvm  # Should show kvm
```

If not, verify your `configuration.nix` and rebuild.

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
