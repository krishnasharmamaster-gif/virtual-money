# Virtual Money — virtual savings

Virtual Money is a small, mobile-first virtual savings app. It lets a child record pretend savings toward a goal and gives a parent a private review view with the same balance, activity, and a note field.

There are no payments, bank connections, or real-money transfers in this prototype. Deposits and deductions are only virtual requests: they stay pending until a parent approves or declines them in the review view.

## Open it

The simplest option is to open `index.html` in a browser. This is an isolated local preview using that browser's storage; it is not synced with the hosted family website.

For shared family sync, use the included standard-library server:

```text
python server.py
```

Set `VIRTUAL_MONEY_USERNAME` and `VIRTUAL_MONEY_PIN` in the server environment before starting it, then open `http://localhost:8000`. The app stores each family record in `data/families.json`. To let a phone on the same Wi-Fi reach it, open `http://<this-computer-ip>:8000` on the phone. For use across different networks, deploy this folder to a host that supports Python, or replace the tiny JSON API with a hosted database.

The included `render.yaml` is ready for a Render web service. Render supplies the `PORT` environment variable automatically.

## Parent review

- Use **Share with Dad** to copy the private review link.
- The parent link opens the same family record with the parent review screen.
- The hosted service requires the family sign-in before it will show family data.

## Private family sign-in

The hosted app protects the family API behind a shared username and 4-digit sign-in code. Before enabling the login update on Render, set these as private environment variables under the service's **Environment** settings:

- `VIRTUAL_MONEY_USERNAME`
- `VIRTUAL_MONEY_PIN` (exactly four digits)

Do not put either value in this repository or share the code in a public place. The server sets an HttpOnly session cookie, expires sessions after 8 hours, and temporarily blocks sign-in after 5 failed attempts in 15 minutes. Sign out on shared devices. A four-digit code is only a basic privacy barrier, not strong security; do not use this prototype for real money or sensitive information.

## What is included

- Responsive savings dashboard for phone and desktop
- Virtual balance, goal progress, weekly rhythm chart, and activity feed
- Deposit and deduction requests with preset amounts and an optional note
- Multiple savings goals with active-goal switching and delete confirmations
- Animated Virtual Pro and Virtual Max plan previews (₹100/month and ₹9,999/month), with Max selected by default and the family selection synced to parent review
- Plan prices are illustrative only; there is no checkout, billing, or real subscription
- Parent review view with approval/decline controls, family code, private link, activity, and parent note
- LocalStorage fallback plus optional Python sync API
