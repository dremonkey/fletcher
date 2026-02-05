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
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            flutter
            docker
            docker-compose
          ];

          shellHook = ''
            echo "Fletcher Dev Environment Loaded"
            echo "Bun version: $(bun --version)"
            echo "Flutter version: $(flutter --version | head -n 1)"
          '';
        };
      });
}
