#!/usr/bin/env bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. OS Detection
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)    MACHINE=Mac;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

log_info "Detected OS: $MACHINE"

if [ "$MACHINE" != "Linux" ] && [ "$MACHINE" != "Mac" ]; then
    log_error "Unsupported operating system: $MACHINE. Exiting."
    exit 1
fi

# 2. System Dependency Verification
log_info "Verifying system dependencies..."

if ! command -v nix &> /dev/null; then
    log_error "Nix is not installed. Please install Nix first."
    exit 1
fi

if [ "$MACHINE" == "Linux" ]; then
    # Check for NixOS specific requirement (nix-ld)
    if [ -f /etc/nixos/configuration.nix ]; then
        if ! grep -q "programs.nix-ld.enable" /etc/nixos/configuration.nix && ! command -v nix-ld &> /dev/null; then
             log_warn "nix-ld might not be enabled. It is required for running unpatched binaries (like Android tools/Bun) on NixOS."
             log_warn "Please ensure 'programs.nix-ld.enable = true;' is in your configuration."
        fi
    fi
elif [ "$MACHINE" == "Mac" ]; then
    if ! xcode-select -p &> /dev/null; then
        log_error "Xcode Command Line Tools not found. Run 'xcode-select --install' and try again."
        exit 1
    fi
fi

# 3. Environment Setup & Dependency Installation
# We check if we are already inside a nix shell by looking for a specific env var usually set by the flake devShell
# or just blindly trust the user/script wrapper.
# However, to ensure tools like 'bun' and 'android' are available, we might need to rely on `nix develop`.

log_info "Ensuring development tools are available..."

# Helper to run commands inside nix develop if tools are missing in current PATH
run_in_nix() {
    if ! command -v bun &> /dev/null; then
        log_info "'bun' not found in PATH. Running '$1' via 'nix develop'..."
        nix develop --command bash -c "$1"
    else
        bash -c "$1"
    fi
}

# 4. Monorepo Setup (Bun Install)
log_info "Installing project dependencies with Bun..."
run_in_nix "bun install"

# 5. Android Setup
log_info "Checking Android setup..."

accept_licenses() {
    log_info "Accepting Android SDK licenses..."
    # yes | sdkmanager --licenses is the standard way, but sdkmanager must be in path
    # If using nix flake, ANDROID_HOME should be set or sdkmanager available
    if command -v sdkmanager &> /dev/null; then
        yes | sdkmanager --licenses > /dev/null 2>&1 || true
        log_success "Android licenses accepted."
    else
        log_warn "sdkmanager not found. Skipping license acceptance. Ensure you are in 'nix develop' shell."
    fi
}

run_in_nix "export ANDROID_HOME=\$HOME/Android/Sdk; $(typeset -f accept_licenses); accept_licenses"

# Check for AVDs
check_avd() {
    if command -v avdmanager &> /dev/null; then
        if avdmanager list avd | grep -q "Name:"; then
            log_success "Android Virtual Device (AVD) detected."
        else
            log_warn "No Android AVD detected."
            log_info "To create one, open Android Studio or run 'avdmanager create avd ...'"
            log_info "NixOS Tip: You might need to run Android Studio from the flake to see the correct SDK path."
        fi
    else
        log_warn "avdmanager not found. Skipping AVD check."
    fi
}
run_in_nix "$(typeset -f check_avd); check_avd"

# 6. iOS Setup (Mac Only)
if [ "$MACHINE" == "Mac" ]; then
    log_info "Running iOS Pod Setup..."
    if [ -d "ios" ]; then
        # Ensure cocoapods is installed (usually via Gemfile or nix flake)
        # Assuming nix flake provides it or system ruby is used
        run_in_nix "cd ios && (bundle install || true) && bundle exec pod install"
        log_success "iOS dependencies installed."
    else
        log_warn "No 'ios' directory found. Skipping Pod install."
    fi
fi

log_success "Bootstrap complete! 🚀"
log_info "You can now start development with: nix develop"
