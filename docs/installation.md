# Installation

TS6 Manager publishes four container images for immutable releases:

| Service | Image |
|---|---|
| Backend | `ghcr.io/inmortalis/ts6-manager/backend:latest` |
| Frontend | `ghcr.io/inmortalis/ts6-manager/frontend:latest` |
| Sidecar | `ghcr.io/inmortalis/ts6-manager/sidecar:latest` |
| All-in-one | `ghcr.io/inmortalis/ts6-manager/all-in-one:latest` |

Release images are published after a Release Please release is created. Ordinary pushes and pull requests do not publish GHCR images.

## Split stack

The default deployment uses separate frontend, backend, and media-sidecar containers.

1. Download [`docker-compose.yml`](../docker-compose.yml).
2. Create a `.env` file with at least:

~~~env
JWT_SECRET=generate-a-random-secret
ENCRYPTION_KEY=generate-a-second-stable-secret
SIDECAR_SECRET=generate-a-third-shared-secret
~~~

Generate strong values with OpenSSL if available:

~~~bash
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "SIDECAR_SECRET=$(openssl rand -base64 32)" >> .env
~~~

3. Start the stack:

~~~bash
docker compose up -d
~~~

4. Open `http://localhost:3000/setup`.
5. Create the initial administrator.
6. Add a TeamSpeak connection under **Settings → Connections**.

The backend is exposed on port 3001 by the stock compose file. The media sidecar remains on the internal Docker network and is not published to the host.

## All-in-one

The all-in-one image runs nginx, the backend, and the Go media sidecar in one container.

~~~bash
docker compose -f docker-compose.all-in-one.yml up -d
~~~

Open `http://localhost:3000` unless you changed `HOST_PORT`.

Only nginx is published. Backend and sidecar services remain internal to the container.

## Build from source

For Home Screen or desktop app installation after deployment, see [Install TS6 Manager as an app](pwa.md). PWA installation requires HTTPS (except on localhost).

Development and local image builds use Node.js 20+ and pnpm 9.x.

~~~bash
git clone https://github.com/Inmortalis/ts6-manager.git
cd ts6-manager
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
~~~

For a local Docker build **with TeamSpeak 6 (beta13)**:

~~~bash
cp .env.pr-test.example .env
docker compose -f docker-compose.pr-test.yml up --build
~~~

Manager-only (no TeamSpeak container):

~~~bash
docker compose -f docker-compose.local.yml up -d --build
~~~

See [Configuration](configuration.md) before using a production deployment.

## Release setup for fork maintainers

1. Open the fork’s **Actions** tab. If GitHub shows an activation prompt, enable workflows in the fork.
2. Go to **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**, and save. Release Please uses the repository’s `GITHUB_TOKEN` to open and update the release PR. [GitHub Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
3. After release-eligible changes reach `main`, Release Please opens a release PR. If the first PR is missing after setup, select **Actions → Release Please → Run workflow** and choose `main`. Review and merge the PR when ready to publish. The merge creates the `vX.Y.Z` release and starts the image build. Wait for the publish jobs to succeed before pulling `:latest`. To recover an older release, run **Publish container images** with its existing `vX.Y.Z` tag. For an older release, recovery republishes only the exact version and commit-SHA tags. The current release keeps `:latest`.
4. After the first publish, check each image under the fork owner’s **Packages → Package settings**. Public images allow anonymous pulls. For private images, the deploying account needs read access to each package in its Compose stack. Run `docker login ghcr.io -u YOUR_GITHUB_USERNAME` on the deployment host and enter a classic personal access token with `read:packages` at the password prompt. Then run `docker compose pull`. [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
