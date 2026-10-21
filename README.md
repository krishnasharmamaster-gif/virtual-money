# Virtual Money — virtual savings

Virtual Money is a small, mobile-first virtual savings app. It lets a child record pretend savings toward a goal and gives a parent a private review view with the same balance, activity, and a note field.

There are no payments, bank connections, or real-money transfers in this prototype. Deposits and deductions are only virtual requests: they stay pending until a parent approves or declines them in the review view.

## Open it

The simplest option is to open `index.html` in a browser. This uses local browser storage, so it is a single-device preview.

For shared family sync, use the included standard-library server:

```text
python server.py
```

Then open `http://localhost:8000`. The app stores each family record in `data/families.json`. To let a phone on the same Wi-Fi reach it, open `http://<this-computer-ip>:8000` on the phone. For use across different networks, deploy this folder to a host that supports Python, or replace the tiny JSON API with a hosted database.

The included `render.yaml` is ready for a Render web service. Render supplies the `PORT` environment variable automatically.

## Parent review

- Starter family code: `VM-2047`
- Starter parent code: `2047`
- Use **Share with Dad** to copy the private review link.
- The parent link opens the same family record with the passcode screen first.

## What is included

- Responsive savings dashboard for phone and desktop
- Virtual balance, goal progress, weekly rhythm chart, and activity feed
- Deposit and deduction requests with preset amounts and an optional note
- Parent review view with approval/decline controls, family code, private link, activity, and parent note
- LocalStorage fallback plus optional Python sync API
