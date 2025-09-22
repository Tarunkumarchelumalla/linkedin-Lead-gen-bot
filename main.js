import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.json({ limit: '5mb' })); // allow big cookie JSON

app.post('/scrape', async (req, res) => {
    const { searchUrl, cookies } = req.body;

    if (!searchUrl || !cookies) {
        return res.status(400).json({
            error: 'Missing "searchUrl" or "cookies" in request body'
        });
    }

    try {
        const cookies = JSON.parse(req.body.cookies);

        if (!Array.isArray(cookies)) {
            throw new Error('"cookies" must be an array');
        }

        // Ensure sameSite value is valid
        for (const cookie of cookies) {
            if (!['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
                cookie.sameSite = 'Lax';
            }
        }

        // Launch browser
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await context.addCookies(cookies);
        const page = await context.newPage();

        // Retry navigation
        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`Opening LinkedIn page (attempt ${attempt}/3): ${searchUrl}`);
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                success = true;
                break;
            } catch (err) {
                console.error(`Navigation failed on attempt ${attempt}:`, err.message);
                if (attempt < 3) await page.waitForTimeout(5000);
            }
        }
        if (!success) throw new Error('Failed to open page after 3 attempts.');

        // Wait for feed to load
        await page.waitForTimeout(8000);

        // Scroll down 5 times
        for (let i = 0; i < 5; i++) {
            await page.mouse.wheel(0, 1500);
            await page.waitForTimeout(3000);
        }

        // Scrape posts
        const posts = await page.$$eval(
            '.scaffold-finite-scroll__content ul > li',
            (items) =>
                items
                    .map((li) => {
                        const contentEl = li.querySelector('.break-words.tvm-parent-container');
                        const content = contentEl?.innerText?.trim() || null;
                        return { content };
                    })
                    .filter((p) => p.content)
        );

        await browser.close();

        return res.json({
            searchUrl,
            results: posts
        });
    } catch (err) {
        console.error('Scraper Error:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => {
    console.log('Scraper API running on http://localhost:3000');
});
