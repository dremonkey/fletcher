#!/usr/bin/env bash

# Fletcher Project Setup Script

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}Fletcher Infrastructure Setup${NC}"

# Check for prerequisites
check_cmd() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed.${NC}"
        return 1
    fi
    echo -e "${GREEN}✓ $1 found${NC}"
}

echo -e "\n${BLUE}Checking prerequisites...${NC}"
check_cmd docker || exit 1
check_cmd bun || exit 1
check_cmd flutter || exit 1

# Start Docker infrastructure
echo -e "\n${BLUE}Starting local infrastructure (LiveKit)...${NC}"
docker compose up -d

# Validation step
echo -e "\n${BLUE}Validating services...${NC}"

# Check if LiveKit is responding
MAX_RETRIES=10
COUNT=0
until $(curl -sSf http://localhost:7880 > /dev/null 2>&1); do
    if [ $COUNT -ge $MAX_RETRIES ]; then
        echo -e "${RED}Error: LiveKit server failed to start.${NC}"
        exit 1
    fi
    echo "Waiting for LiveKit server... ($((COUNT+1))/$MAX_RETRIES)"
    sleep 2
    COUNT=$((COUNT+1))
done

echo -e "${GREEN}✓ LiveKit server is healthy at http://localhost:7880${NC}"

echo -e "\n${GREEN}Setup complete! Fletcher is ready for development.${NC}"
