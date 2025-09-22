import { Actor } from 'apify';
import fs from 'fs';
import { chromium } from 'playwright';

(async () => {
    await Actor.init();

    try {
        // ----- Robust INPUT Handling -----
        let input = await Actor.getInput();
        if (!input) {
            const inputArg = process.argv.find(arg => arg.startsWith('--input='));
            if (inputArg) {
                input = JSON.parse(inputArg.replace('--input=', ''));
            } else {
                input = {
                    searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=ai%20content%20backlash%20forecasted',
                    cookiesFile: 'cookies.json',
                };
            }
        }
        console.log('Using input:', input);

        const { searchUrl, cookiesFile = 'cookies.json' } = input;
        if (!searchUrl) {
            throw new Error('Input must contain "searchUrl" property with LinkedIn search URL');
        }

        // ----- Load cookies -----
        if (!fs.existsSync(cookiesFile)) {
            throw new Error(`Cookies file "${cookiesFile}" not found`);
        }
        const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'));
        if (!Array.isArray(cookies)) {
            throw new Error('cookies.json must contain a JSON array');
        }
        for (const cookie of cookies) {
            if (!['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
                cookie.sameSite = 'Lax';
            }
        }

        // ----- Launch browser and context -----
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
        });
        await context.addCookies(cookies);
        const page = await context.newPage();

        // Retry navigation up to 3 times
        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`Opening LinkedIn page (attempt ${attempt}/3): ${searchUrl}`);
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                success = true;
                break;
            } catch (err) {
                console.error(`Navigation failed on attempt ${attempt}:`, err.message);
                if (attempt < 3) {
                    console.log('Retrying in 5s...');
                    await page.waitForTimeout(5000);
                } else {
                    throw err; // rethrow after 3rd failure
                }
            }
        }

        if (!success) throw new Error('Failed to open page after 3 attempts.');

        // Give LinkedIn’s feed/activity page time to populate
        console.log('Waiting for feed to load...');
        await page.waitForTimeout(8000);

        // Infinite scroll - scroll down 5 times with delay
        for (let i = 0; i < 5; i++) {
            await page.mouse.wheel(0, 1500);
            console.log(`Scrolled down ${i + 1}/5 times`);
            await page.waitForTimeout(3000);
        }

        // ----- Scrape posts instead of profiles -----
        const posts = await page.$$eval(
            '.scaffold-finite-scroll__content ul > li',
            (items) =>
                items.map((li) => {
                    const contentEl = li.querySelector('.break-words.tvm-parent-container');
                    const content = contentEl?.innerText?.trim() || null;
                    return { content };
                }).filter(p => p.content) // only keep non-empty
        );

        console.log(`Scraped ${posts.length} posts`);
        await Actor.pushData(posts);

        await browser.close();
        await Actor.exit();
    } catch (error) {
        console.error('Scraper Error:', error);
        await Actor.exit();
        process.exit(1);
    }
})();
