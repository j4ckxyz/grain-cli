#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${GRAIN_REPO_URL:-https://github.com/j4ckxyz/grain-cli.git}"
INSTALL_DIR="${HOME}/.grain-cli"

echo "Installing grain from ${REPO_URL}"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required but not found."
  echo "Install Bun: https://bun.sh/docs/installation"
  exit 1
fi

if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "Updating existing install at ${INSTALL_DIR}"
  git -C "${INSTALL_DIR}" fetch --depth=1 origin main
  git -C "${INSTALL_DIR}" reset --hard origin/main
else
  rm -rf "${INSTALL_DIR}"
  git clone --depth=1 "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
bun install --frozen-lockfile
bun install -g "${INSTALL_DIR}"

BIN_DIR="$(bun pm -g bin)"
if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
  SHELL_NAME="$(basename "${SHELL:-}")"
  if [ "${SHELL_NAME}" = "zsh" ]; then
    RC_FILE="${HOME}/.zshrc"
  elif [ "${SHELL_NAME}" = "bash" ]; then
    RC_FILE="${HOME}/.bashrc"
  else
    RC_FILE="${HOME}/.profile"
  fi

  echo "export PATH=\"${BIN_DIR}:\$PATH\"" >> "${RC_FILE}"
  export PATH="${BIN_DIR}:$PATH"
  echo "Added ${BIN_DIR} to PATH in ${RC_FILE}"
fi

echo "grain installed."
echo "Run: exec \"${SHELL:-/bin/sh}\" -l"
echo "Then: grain help"
