// ktmb_scraper.js

import puppeteer from "puppeteer";
import fetch from "node-fetch";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Sends text messages to telegram
 */
async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("❌ Failed to send telegram message:", err);
  }
}

(async () => {
  console.log("🚆 Starting KTMB scraper...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  await page.goto("https://online.ktmb.com.my/Trip", { waitUntil: "networkidle2" });

  // ▪ Select origin & destination
  await page.waitForSelector("#FromStationId");
  await page.select("#FromStationId", "19100"); // KL Sentral
  await page.select("#ToStationId", "42400");   // Gurun

  // ▪ Open date picker
  await page.waitForSelector("#OnwardDate");
  await page.click("#OnwardDate");

  // ▪ Wait for calendar UI
  await page.waitForSelector(".lightpick");

  // ▪ Select year 2026
  await page.waitForSelector(".lightpick__select-years");
  await page.select(".lightpick__select-years", "2026");

  // ▪ Select month = 2 (March, but UI is zero-indexed)
  await page.waitForSelector(".lightpick__select-months");
  await page.select(".lightpick__select-months", "1");

  // ▪ Pick date 24
  const daySelector =
    '.lightpick__day.is-available:not(.is-previous-month):not(.is-next-month)';

  await page.waitForSelector(daySelector);

  const days = await page.$$(daySelector);
  for (const d of days) {
    const text = await page.evaluate((el) => el.textContent, d);
    if (text.trim() === "24") {
      await d.click();
      break;
    }
  }

  // ▪ Confirm date
  await page.waitForSelector(".picker-btn");
  await page.click(".picker-btn");

  // ▪ Scroll to enable button
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
  await new Promise((r) => setTimeout(r, 300));

  // ▪ Click SEARCH
  await page.waitForSelector("#btnSubmit", { visible: true });
  await page.click("#btnSubmit");

  // ▪ Wait for table
  await page.waitForSelector(".depart-trips tr", { timeout: 60000 });

  // ▪ Extract train rows
  const trains = await page.evaluate(() => {
    const rows = document.querySelectorAll(".depart-trips tr");
    return Array.from(rows).map((row) => {
      const cells = row.querySelectorAll("td");
      return {
        train: cells[0]?.innerText.trim() || "",
        departure: cells[1]?.innerText.trim() || "",
        arrival: cells[2]?.innerText.trim() || "",
        duration: cells[3]?.innerText.replace(/\s+/g, " ").trim() || "",
        seats: cells[4]?.childNodes[1]?.nodeValue.trim() || "",
        fare: cells[5]?.innerText.trim() || "",
      };
    });
  });

  console.log("📌 Scraped trains:", trains);

  // ▪ Filter trains where seats > 2
  let alerts = [];

  for (const train of trains) {
    const seatsNum = parseInt(train.seats.replace(/\D/g, ""), 10);

    if (!isNaN(seatsNum) && seatsNum > 2) {
      alerts.push(
        `🚆 *Train:* ${train.train}\n🕒 *Depart:* ${train.departure}\n💺 *Seats Available:* *${seatsNum}*`
      );
    }
  }

  if (alerts.length > 0) {
    const message = `🔥 *KTMB Availability Alert!*\nSeats > 2 detected:\n\n${alerts.join(
      "\n\n"
    )}`;

    await sendTelegram(message);
    console.log("📨 Alert sent to Telegram");
  } else {
    console.log("ℹ No trains with more than 2 seats.");
  }

  await browser.close();
})();
