import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const INPUT_FILE = path.resolve(process.cwd(), 'addys.txt');
const OUTPUT_JSON = path.resolve(process.cwd(), 'similar-contracts.json');
const OUTPUT_CSV = path.resolve(process.cwd(), 'similar-contracts.csv');

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function readInputAddresses() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  return fs
    .readFileSync(INPUT_FILE, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((value) => ADDRESS_RE.test(value));
}

function parseSimilarAddresses(html: string) {
  const $ = cheerio.load(html);
  const seen = new Set<string>();

  $('a[href*="/address/"]').each((_index, element) => {
    const href = $(element).attr('href') ?? '';
    const match = href.match(/\/address\/(0x[a-fA-F0-9]{40})/i);

    if (!match) {
      return;
    }

    const address = match[1].toLowerCase();
    if (ADDRESS_RE.test(address)) {
      seen.add(address);
    }
  });

  return Array.from(seen).sort();
}

async function fetchSimilarContracts(address: string) {
  const url = `https://etherscan.io/find-similar-contracts?a=${address}&m=low&ps=25&mt=1`;

  const { data } = await axios.get(url, {
    headers: {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      referer: 'https://etherscan.io/',
    },
    timeout: 30000,
  });

  return parseSimilarAddresses(data);
}

async function main() {
  const addresses = readInputAddresses();
  const results: Array<{ sourceAddress: string; similarAddresses: string[]; count: number }> = [];
  const allSimilar = new Set<string>();

  console.log(`Found ${addresses.length} addresses in ${INPUT_FILE}`);

  for (const address of addresses) {
    try {
      const similarAddresses = await fetchSimilarContracts(address);
      results.push({
        sourceAddress: address,
        similarAddresses,
        count: similarAddresses.length,
      });

      for (const similarAddress of similarAddresses) {
        allSimilar.add(similarAddress);
      }

      console.log(`Processed ${address}: ${similarAddresses.length} similar contract(s)`);

      await new Promise((resolve) => setTimeout(resolve, 1200));
    } catch (error) {
      console.error(`Failed to fetch similar contracts for ${address}:`, error);
      results.push({
        sourceAddress: address,
        similarAddresses: [],
        count: 0,
      });
    }
  }

  const uniqueSimilar = Array.from(allSimilar).sort();

  const jsonOutput = {
    generatedAt: new Date().toISOString(),
    sourceAddresses: addresses,
    results,
    uniqueSimilarContracts: uniqueSimilar,
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(jsonOutput, null, 2)}\n`);

  const csvLines = ['source_address,similar_address'];
  for (const result of results) {
    for (const similarAddress of result.similarAddresses) {
      csvLines.push(`${result.sourceAddress},${similarAddress}`);
    }
  }
  fs.writeFileSync(OUTPUT_CSV, `${csvLines.join('\n')}\n`);

  console.log(`Saved ${uniqueSimilar.length} unique similar contract addresses to ${OUTPUT_JSON}`);
  console.log(`Saved pair-level results to ${OUTPUT_CSV}`);
}

main().catch((error) => {
  console.error('Fatal error while scraping Etherscan similar contracts:', error);
  process.exit(1);
});
