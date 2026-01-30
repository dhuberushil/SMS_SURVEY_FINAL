# What is systemd and a sample unit for this app

systemd is the init system used by most modern Linux distributions (including Ubuntu). It manages system services, their automatic startup, restarts, logging, and dependencies. A "unit file" tells systemd how to start, stop, and supervise a service.

When you deploy a Node.js app you can either:

- Use a process manager like `pm2` (recommended for Node apps) which itself can be started by a systemd unit; or
- Run the Node process directly under systemd with a unit file.

Sample systemd unit (run Node directly)

Create `/etc/systemd/system/sms-survey.service` with the following contents (adjust `User`, `Group`, and paths):

```
[Unit]
Description=SMS Survey Engine
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/sms-survey-engine
EnvironmentFile=/opt/sms-survey-engine/.env
ExecStart=/usr/bin/node /opt/sms-survey-engine/src/server.js
Restart=always
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

Important notes:

- `EnvironmentFile` should point to a file with `KEY=VALUE` lines (no exported shell code). Keep this file secure (permissions 600) and do not commit it to source control.
- The `User`/`Group` should be a non-root account that has access to the app and secret files.
- Run `sudo systemctl daemon-reload` after creating the unit, then `sudo systemctl enable --now sms-survey.service` to start it and enable at boot.
- Check status and logs: `sudo systemctl status sms-survey.service` and `journalctl -u sms-survey.service -f`.

Using `pm2` with systemd (recommended for cluster mode)

If you use `pm2`, start your app with `pm2 start ecosystem.config.js --env production` and then run:

```bash
pm2 save
sudo pm2 startup systemd -u youruser --hp /home/youruser
# follow the printed sudo command to enable the pm2 systemd service
```

This will create a systemd unit that launches `pm2` on boot and restores your process list.
