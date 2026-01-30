# Production deployment (Ubuntu AWS)

This document explains how to deploy this Node.js application to an Ubuntu server (EC2) for production.

Prerequisites

- Ubuntu 20.04 or later (on EC2)
- A non-root user with `sudo` privileges
- A domain name (optional, recommended)

1. Install OS packages

# Production deployment (Ubuntu / AWS)

This document provides a practical, step-by-step production deployment guide for the `sms-survey-engine` Node.js app on an Ubuntu server (EC2). It covers installing required OS packages, running the app (PM2 or Docker), installing Postgres on the same machine, basic AWS cloud configuration tips (EC2, Security Groups, S3, IAM, Route53), TLS, and troubleshooting.

# Production deployment (Ubuntu / AWS)

This document provides a practical, step-by-step production deployment guide for the `sms-survey-engine` Node.js app on an Ubuntu server (EC2). It covers installing required OS packages, running the app (PM2 or Docker), installing Postgres on the same machine, basic AWS cloud configuration tips (EC2, Security Groups, S3, IAM, Route53), TLS, and troubleshooting.

Quick checklist

- Ubuntu 20.04 or later (EC2)
- Non-root sudo user
- Domain name (recommended)
- SSH keypair for server access
- Optional: AWS account and permissions to create EC2, S3, IAM, Route53 resources

1. Install OS packages

Update apt and install the packages listed in the repository root `packages.txt`:

```bash
sudo apt update
xargs sudo apt install -y < packages.txt
```

2. Install Node.js (LTS) and `pnpm`

Install Node.js via NodeSource (choose LTS; 18.x or 20.x):

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm
```

3. Clone, install dependencies and build

```bash
git clone <your-repo-url> app
cd app
pnpm install
```

4. `.env` and example

Create a `.env` (never commit it). A ready example is provided in `.env.example` in the project root — copy it and fill values:

```bash
cp .env.example .env
# then edit .env with secrets
```

Important env keys (also reflected in `.env.example`):

- `DATABASE_URL` or `DB_NAME`/`DB_USER`/`DB_PASS`/`DB_HOST`/`DB_PORT`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `S3_BUCKET`, `S3_REGION` (optional)
- `FORM_BASE_URL` (used for Step B links)
- `PORT`, `NODE_ENV`, `TRUST_PROXY`

5. Install Postgres on the same Ubuntu server (optional)

If you want Postgres on the same EC2 instance (simple setup, not recommended for large scale):

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

# Switch to postgres user and create DB + user
sudo -u postgres psql -c "CREATE USER sms_user WITH PASSWORD 'strongpassword';"
sudo -u postgres psql -c "CREATE DATABASE sms_survey OWNER sms_user;"

# Allow password authentication and remote connections (optional). Edit /etc/postgresql/*/main/pg_hba.conf
sudo sed -i "s/^#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/*/main/postgresql.conf
echo "host    all             all             0.0.0.0/0               md5" | sudo tee -a /etc/postgresql/*/main/pg_hba.conf
sudo systemctl restart postgresql

# If you opened remote access, restrict with UFW / security groups
```

Notes:

- Prefer local socket/127.0.0.1 connections for better security (set `DB_HOST=127.0.0.1`).
- Use a strong password for the DB user and restrict firewall/Security Group rules if allowing remote access.
- For production scalability and backups, consider using Amazon RDS instead of hosting Postgres on the same EC2 instance.

6. Run the app (PM2 recommended)

An `ecosystem.config.js` is included. To run in production:

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
# run the command printed by pm2 startup
```

Alternative: use Docker / Docker Compose. A `Dockerfile` and `docker-compose.yml` are present.

Running Docker Compose (production)

This repo includes `docker-compose.prod.yml` which runs a Postgres container and the app. Steps:

```bash
# copy and edit .env
cp .env.example .env
# build and start the production stack
docker-compose -f docker-compose.prod.yml up -d --build

# follow app logs
docker-compose -f docker-compose.prod.yml logs -f app

# run a one-off migration (if you add sequelize-cli and migrations):
docker-compose -f docker-compose.prod.yml run --rm app npx sequelize-cli db:migrate

# stop the stack
docker-compose -f docker-compose.prod.yml down
```

Notes:

- Ensure the `.env` values match the `db` service (user/password) or set `DATABASE_URL` to point at the `db` host.
- The `docker-compose.prod.yml` mounts a persistent named volume for Postgres data (`db_data`).
- For production TLS and reverse-proxy integration consider using a separate Nginx/Traefik container in front of the app.

7. Nginx reverse proxy + TLS (Let's Encrypt)

Create an Nginx site at `/etc/nginx/sites-available/sms-survey` with this example (replace domain):

```nginx
server {
  listen 80;
  server_name your.domain.example;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
  }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/sms-survey /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your.domain.example
```

8. Firewall / UFW

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

9. AWS cloud-specific recommendations

- EC2 instance
  - Use an appropriate instance size (t3.small/t3.medium for small workloads).
  - Use an EBS volume with enough IOPS/size and enable automated snapshots/backups.
  - Assign an Elastic IP if you need a stable public address.

- Security Groups
  - Allow ports: `22` (SSH restricted to your IP), `80`, `443` to the world.
  - Allow outbound traffic for Twilio, S3, and database connections.

- Route53 (DNS)
  - Create an `A` record pointing to your Elastic IP or ALB.

- S3
  - Create an S3 bucket for file uploads (if used). Configure bucket policy and region and set environment vars `S3_BUCKET` and `S3_REGION`.

- IAM
  - Create an IAM user with minimal S3 permissions (PutObject/DeleteObject/GetObject) for the app and store keys securely (use Secrets Manager or environment vars).

- RDS (recommended for production DB)
  - For production, prefer Amazon RDS Postgres (managed backups, Multi-AZ, monitoring). Set `DATABASE_URL` to the RDS connection string and restrict RDS to your app's security group.

- ACM + Load Balancer (optional)
  - If you need auto-scaling or multiple EC2 instances, use an Application Load Balancer with ACM-managed certificates and target your EC2 instances or ECS tasks.

- Secrets management
  - Use AWS Secrets Manager or Parameter Store for DB and Twilio credentials instead of plaintext `.env` in production.

10. Backups & Monitoring

- Database backups: automated (RDS) or `pg_dump` scheduled snapshots for self-hosted Postgres.
- Logs: use `pm2 logs`, `cloudwatch`, or forward logs to a logging service.
- Health checks: the app exposes `/health` for basic probes.

11. Database migrations

This project uses `sequelize.sync()` for convenience. For production use consider switching to `sequelize-cli` and explicit migrations. Example:

```bash
pnpm install --save-dev sequelize-cli
npx sequelize-cli init
# add migrations and run: npx sequelize-cli db:migrate
```

12. Troubleshooting

- Check app logs: `pm2 logs sms-survey-engine`
- Check process status: `pm2 status`
- Health endpoint: `curl http://127.0.0.1:3000/health`
- Nginx errors: `sudo journalctl -u nginx` or `/var/log/nginx/error.log`

Security & operational notes

- Never commit secrets or `.env` to git.
- Use managed services (RDS, S3) for reliability and backups when possible.
- Restrict SSH access to known IP ranges and enable automatic security updates where feasible.

Files added for deployment help:

- `packages.txt` — apt packages list
- `ecosystem.config.js` — PM2 config
- `.env.example` — template of required environment variables

If you'd like, I can also:

- add a sample `systemd` unit file for the app,
- add a Docker Compose production example that includes a Postgres container,
- or prepare a step-by-step AWS CloudFormation / Terraform snippet to provision EC2 + Security Group + S3 + RDS.
- Restrict SSH access to known IP ranges and enable automatic security updates where feasible.

Files added for deployment help:

- `packages.txt` — apt packages list
- `ecosystem.config.js` — PM2 config
- `.env.example` — template of required environment variables

If you'd like, I can also:

- add a sample `systemd` unit file for the app,
- add a Docker Compose production example that includes a Postgres container,
- or prepare a step-by-step AWS CloudFormation / Terraform snippet to provision EC2 + Security Group + S3 + RDS.
