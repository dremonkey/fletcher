{
  description = "Fletcher development environment";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };

        androidComposition = pkgs.androidenv.composeAndroidPackages {
          buildToolsVersions = [ "34.0.0" "35.0.0" "36.0.0" ];
          platformVersions = [ "34" "36" ];
          abiVersions = [ "x86_64" "arm64-v8a" ];
          includeNDK = true;
          ndkVersion = "28.2.13676358";
          cmakeVersions = [ "3.22.1" ];
          includeEmulator = true;
          includeSystemImages = true;
          systemImageTypes = [ "google_apis_playstore" ];
          includeSources = true;
          includeExtras = [ "extras;google;m2repository" "extras;android;m2repository" ];
        };

        androidSdk = androidComposition.androidsdk;
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            flutter
            docker
            docker-compose
            jdk17
            android-studio
            androidSdk
            nil # Nix language server for editor support

            # GPU acceleration for Android emulator
            libglvnd
            vulkan-loader
          ];

          shellHook = ''
            export ANDROID_HOME=${androidSdk}/libexec/android-sdk
            export ANDROID_SDK_ROOT=$ANDROID_HOME
            export ANDROID_NDK_HOME="$ANDROID_HOME/ndk-bundle"
            export JAVA_HOME=${pkgs.jdk17.home}
            export CHROME_EXECUTABLE=${pkgs.google-chrome}/bin/google-chrome

            # Add Android SDK tools to PATH
            export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/tools/bin:$PATH"

            # NixOS: Use system GPU drivers instead of emulator's bundled libs
            export ANDROID_EMULATOR_USE_SYSTEM_LIBS=1

            # NixOS: Use aapt2 from Nix SDK (Gradle's downloaded binary won't run on NixOS)
            # Generate local.properties with the correct aapt2 path for this Nix store
            if [ -d "apps/mobile/android" ]; then
              echo "android.aapt2FromMavenOverride=$ANDROID_HOME/build-tools/35.0.0/aapt2" > apps/mobile/android/local.properties
              echo "sdk.dir=$ANDROID_HOME" >> apps/mobile/android/local.properties
            fi

            echo "Fletcher Dev Environment Loaded"
            echo "Bun version: $(bun --version)"
            echo "Flutter version: $(flutter --version | head -n 1)"
            echo "Android SDK: $ANDROID_HOME"
            echo "Java Home: $JAVA_HOME"
          '';
        };
      });
}
