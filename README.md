# Sim Companies retail profit calculator

Pick a building, enter your admin overhead, and it ranks every product that building sells by
profit per hour — with the best quality to buy and the best price to sell at. It uses the same
formula as the game's own Sales Calculator. Hover or tap any **?** to see what a field means.

## Quick use (nothing to install)

Download the repo (**Code → Download ZIP**), unzip, and double-click `retail-calculator.html`.
It works offline with the prices bundled in `retail-prices.js` (from 12 Oct 2026). Prices move,
so open a product and type your current buy prices.

## With live price refresh

Needs [Node.js](https://nodejs.org) 18 or newer.

- **macOS:** double-click `start.command` (first time: right-click → Open)
- **Windows:** double-click `start.bat`
- **Any OS:** in a terminal in this folder, run `node serve.mjs` and open <http://localhost:8765>

Leave that window open while you use the calculator; close it to stop.

- **Refresh all prices (1 request)** updates the cheapest Q0 price of every product at once.
  Higher qualities are estimated from each product's last known quality premium (shown as
  "est." in the Price age column).
- **Exact quality prices for this building** fetches each product's full order book, one
  product per request.

## The game's API limit — please read

Sim Companies allows **one API request every 5 minutes**. Going faster risks a captcha or your
account. The server enforces this (5 min 5 s between requests, remembered across restarts), but
run only **one** copy, and don't run other Sim Companies API tools at the same time.

It reads public market data only: no login, nothing about your account.
Realm is Magnates by default; for Entrepreneurs start it with `SIMCO_REALM=1 node serve.mjs`.

Unofficial fan tool, not affiliated with Sim Companies.
