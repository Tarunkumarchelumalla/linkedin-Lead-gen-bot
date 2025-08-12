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
                    searchUrl: 'https://www.linkedin.com/search/results/people/?keywords=n8n%20automation%20workflow',
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

        console.log(`Opening LinkedIn search page: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle' });

        // Infinite scroll - scroll down 5 times with delay
        for (let i = 0; i < 5; i++) {
            await page.mouse.wheel(0, 1500);
            console.log(`Scrolled down ${i + 1}/5 times`);
            await page.waitForTimeout(3000);
        }

        // ----- Scrape profiles using tags and attributes only -----
        // ----- Scrape profiles using tags and attributes only -----
        const profiles = await page.$$eval('ul[role="list"] > li', items =>
            items.map(li => {
              const resultEl = li.querySelector('[data-chameleon-result-urn]') || li;
              const urn = resultEl.getAttribute('data-chameleon-result-urn') || null;
          
              const linkedArea = resultEl.querySelector('.linked-area') || resultEl;
              const childDivs = Array.from(linkedArea.children).filter(n => n.tagName === 'DIV');
              const firstDiv = childDivs[0] || linkedArea;
              const secondDiv = childDivs[1] || linkedArea;
          
              // Profile link & name from SAME <a>
              const profileAnchor = firstDiv.querySelector('a[href*="/in/"], a[data-test-app-aware-link]');
              const profileUrl = profileAnchor?.href || null;
              const name = secondDiv?.querySelector('span[aria-hidden="true"]')?.textContent?.trim() || null;
          
              // Profile picture
              const profilePic = firstDiv.querySelector('img')?.src || null;
          
              // Headline
              const headline = secondDiv.querySelector('.t-14.t-black.t-normal')?.textContent?.trim() || null;
          
              // Location
              let location = null;
              const headlineEl = secondDiv.querySelector('.t-14.t-black.t-normal');
              if (headlineEl?.nextElementSibling?.classList.contains('t-14') &&
                  headlineEl?.nextElementSibling?.classList.contains('t-normal')) {
                location = headlineEl.nextElementSibling.textContent?.trim() || null;
              }
          
              // Summary
              const summary = secondDiv.querySelector('p.entity-result__summary--2-lines')?.textContent?.trim() || null;
          
              return { urn, name, profileUrl, profilePic, headline, location, summary, followers: null };
            })
          );
          
        console.log(`Scraped ${profiles.length} profiles`);
        await Actor.pushData(profiles);

        await browser.close();
        await Actor.exit();
    } catch (error) {
        console.error('Scraper Error:', error);
        await Actor.exit();
        process.exit(1);
    }
})();
