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
          config.allowUnfree = true;
        };

        androidComposition = pkgs.androidenv.composeAndroidPackages {
          buildToolsVersions = [ "34.0.0" ];
          platformVersions = [ "34" ];
          abiVersions = [ "x86_64" ];
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
          ];

          shellHook = ''
            export ANDROID_HOME=${androidSdk}/libexec/android-sdk
            export ANDROID_SDK_ROOT=$ANDROID_HOME
            export JAVA_HOME=${pkgs.jdk17.home}
            export CHROME_EXECUTABLE=${pkgs.google-chrome}/bin/google-chrome
            
            # Add Android SDK tools to PATH
            export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/tools/bin:$PATH"

            echo "Fletcher Dev Environment Loaded"
            echo "Bun version: $(bun --version)"
            echo "Flutter version: $(flutter --version | head -n 1)"
            echo "Android SDK: $ANDROID_HOME"
            echo "Java Home: $JAVA_HOME"
          '';
        };
      });
}
