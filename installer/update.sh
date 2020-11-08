#!/bin/bash
# +---------+
# | updater |
# +---------+

# get the installer directory
Installer_get_current_dir () {
  SOURCE="${BASH_SOURCE[0]}"
  while [ -h "$SOURCE" ]; do
    DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"
    SOURCE="$(readlink "$SOURCE")"
    [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
  done
  echo "$( cd -P "$( dirname "$SOURCE" )" && pwd )"
}

Installer_dir="$(Installer_get_current_dir)"

# move to installler directory
cd "$Installer_dir"
source utils.sh

Installer_info "Welcome to MMM-Pronote updater !"
echo

cd ~/MagicMirror/modules/MMM-Pronote
rm -f package-lock.json

Installer_info "Updating to Release..."

git reset --hard HEAD
git pull
git checkout -f prod
git pull

echo
Installer_info "Deleting ALL libraries for clean install..."
rm -rf node_modules
echo
Installer_info "Ready for Installing the Release..."

# launch installer
npm install
