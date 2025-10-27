const axios = require('axios');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');

class SuiReferralBot {
    constructor(referralCode, proxyList = [], useProxy = false) {
        this.baseURL = 'https://rd-api.tbook.com';
        this.mainnetURL = 'https://fullnode.mainnet.sui.io';
        this.wallets = [];
        this.referralCode = referralCode;
        this.proxyList = proxyList;
        this.useProxy = useProxy;
        this.proxyIndex = 0;
        this.maxRetries = 5;
        this.successCount = 0;
        this.failCount = 0;
        this.csvFilePath = 'wallet.csv';
        this.initializeCSV();
    }

    initializeCSV() {
        try {
            if (!fs.existsSync(this.csvFilePath)) {
                const header = 'No,Phrase,Private Key,Address,User Code,Referral Used,Batch,Proxy Used,Status\n';
                fs.writeFileSync(this.csvFilePath, header, 'utf-8');
                console.log(`âœ… File ${this.csvFilePath} berhasil dibuat`);
            } else {
                console.log(`âœ… File ${this.csvFilePath} sudah ada, akan menambahkan data baru`);
            }
        } catch (error) {
            console.error(`âŒ Error initializing CSV: ${error.message}`);
        }
    }

    async saveWalletToCSV(wallet, status = 'SUCCESS') {
        try {
            const phrase = wallet.keypair.getSecretKey ? 
                          Buffer.from(wallet.keypair.getSecretKey()).toString('hex').substring(0, 64) : 
                          'N/A';
            
            const privateKey = wallet.keypair.export ? 
                              wallet.keypair.export().privateKey : 
                              Buffer.from(wallet.keypair.getSecretKey()).toString('hex');
            
            const proxyUsed = wallet.proxy ? this.maskProxy(wallet.proxy) : 'Direct IP';
            
            const csvLine = `${wallet.walletNum},"${phrase}","${privateKey}","${wallet.address}","${wallet.userCode || 'N/A'}","${this.referralCode}",${wallet.batchNum},"${proxyUsed}","${status}"\n`;
            
            fs.appendFileSync(this.csvFilePath, csvLine, 'utf-8');
            
            return true;
        } catch (error) {
            console.error(`   âš ï¸  Error saving to CSV: ${error.message}`);
            return false;
        }
    }

    getRandomDelay(min = 1000, max = 3000) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    getNextProxy() {
        if (!this.useProxy || this.proxyList.length === 0) {
            return null;
        }
        
        const proxy = this.proxyList[this.proxyIndex % this.proxyList.length];
        this.proxyIndex++;
        
        return proxy;
    }

    maskProxy(proxy) {
        if (!proxy) return 'No proxy';
        try {
            const url = new URL(proxy);
            if (url.username && url.password) {
                return `${url.protocol}//${url.username}:****@${url.host}`;
            }
            return proxy;
        } catch {
            return proxy.substring(0, 20) + '...';
        }
    }

    async checkProxyIP(proxy) {
        try {
            const config = {
                timeout: 8000,
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                }
            };

            if (proxy) {
                config.httpsAgent = new HttpsProxyAgent(proxy);
                config.httpAgent = new HttpsProxyAgent(proxy);
            }

            const response = await axios.get('https://api.ipify.org?format=json', config);
            
            if (response.data && response.data.ip) {
                return {
                    ip: response.data.ip,
                    country: 'Unknown',
                    city: 'Unknown',
                    org: 'Unknown'
                };
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    getAxiosConfig(wallet = null) {
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://engage.tbook.com',
                'Referer': 'https://engage.tbook.com/',
                'User-Agent': this.getRandomUserAgent()
            },
            timeout: 30000
        };

        if (wallet && wallet.jwt_token) {
            config.headers['Cookie'] = `jwt_token=${wallet.jwt_token}`;
        }

        if (this.useProxy && wallet && wallet.proxy) {
            config.httpsAgent = new HttpsProxyAgent(wallet.proxy);
            config.httpAgent = new HttpsProxyAgent(wallet.proxy);
        }

        return config;
    }

    getRandomUserAgent() {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
        ];
        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    async createNewWallet(walletNum, batchNum) {
        const keypair = new Ed25519Keypair();
        const address = keypair.getPublicKey().toSuiAddress();
        
        const wallet = {
            keypair: keypair,
            address: address,
            jwt_token: null,
            userCode: null,
            proxy: this.getNextProxy(),
            proxyInfo: null,
            walletNum: walletNum,
            batchNum: batchNum
        };
        
        return wallet;
    }

    async retryOperation(operation, operationName, maxRetries, ...args) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation(...args);
                return result;
            } catch (error) {
                if (attempt < maxRetries) {
                    const retryDelay = this.getRandomDelay(2000, 4000);
                    console.log(`   âš ï¸  ${operationName} gagal (${attempt}/${maxRetries}), retry dalam ${(retryDelay/1000).toFixed(1)}s...`);
                    await this.delay(retryDelay);
                } else {
                    throw error;
                }
            }
        }
    }

    async getNonce(address, wallet) {
        const response = await axios.get(`${this.baseURL}/sui/nonce`, {
            params: { address },
            ...this.getAxiosConfig(wallet)
        });
        
        if (response.data && typeof response.data === 'string') {
            const match = response.data.match(/Sign this message to authenticate with TBook: (\d+)/);
            if (match) {
                return match[1];
            }
        }
        
        return Date.now().toString();
    }

    async login(wallet) {
        const nonce = await this.getNonce(wallet.address, wallet);
        const message = `Sign this message to authenticate with TBook: ${nonce}`;
        
        const messageBytes = new TextEncoder().encode(message);
        const { signature: signatureBase64 } = await wallet.keypair.signPersonalMessage(messageBytes);
        const publicKeyBase64 = wallet.keypair.getPublicKey().toBase64();

        const loginPayload = {
            address: wallet.address,
            network: "mainnet",
            publicKey: publicKeyBase64,
            signature: signatureBase64,
            zkLogin: false
        };

        const response = await axios.post(
            `${this.baseURL}/sui/login`, 
            loginPayload, 
            this.getAxiosConfig(wallet)
        );

        if (response.data.code === 200) {
            const setCookie = response.headers['set-cookie'];
            if (setCookie && setCookie[0]) {
                const jwtMatch = setCookie[0].match(/jwt_token=([^;]+)/);
                if (jwtMatch) {
                    wallet.jwt_token = jwtMatch[1];
                }
            }
            return response.data;
        } else {
            throw new Error(`Login gagal dengan code: ${response.data.code}`);
        }
    }

    async getInfo(wallet) {
        const response = await axios.get(
            `${this.baseURL}/info`,
            this.getAxiosConfig(wallet)
        );
        return response.data;
    }

    async markNewUser(wallet) {
        const response = await axios.post(
            `${this.baseURL}/markNewUser`, 
            {},
            this.getAxiosConfig(wallet)
        );
        return response.data;
    }

    async applyReferralCode(wallet, code) {
        const formData = new URLSearchParams();
        formData.append('code', code);

        const config = this.getAxiosConfig(wallet);
        config.headers['Content-Type'] = 'application/x-www-form-urlencoded';

        const response = await axios.post(
            `${this.baseURL}/wise-score-invite-sbt/apply-code`,
            formData,
            config
        );
        return response.data;
    }

    async getUserCode(wallet) {
        const response = await axios.get(
            `${this.baseURL}/twitter/login/userCode`,
            this.getAxiosConfig(wallet)
        );
        
        if (response.data.code) {
            wallet.userCode = response.data.code;
            return response.data;
        }
        return response.data;
    }

    async applySuiInviteCode(wallet, code) {
        const formData = new URLSearchParams();
        formData.append('code', code);

        const config = this.getAxiosConfig(wallet);
        config.headers['Content-Type'] = 'application/x-www-form-urlencoded';

        const response = await axios.post(
            `${this.baseURL}/sui-invite-sbt/apply-code`,
            formData,
            config
        );
        return response.data;
    }

    async processWallet(walletNum, batchNum) {
        const wallet = await this.createNewWallet(walletNum, batchNum);
        const startTime = Date.now();
        
        try {
            console.log(`\n[Batch ${batchNum} | Wallet ${walletNum}] ðŸ†• Starting...`);
            console.log(`   Address: ${wallet.address.substring(0, 20)}...`);
            
            if (this.useProxy && wallet.proxy) {
                console.log(`   Proxy: ${this.maskProxy(wallet.proxy)}`);
                const proxyInfo = await this.checkProxyIP(wallet.proxy);
                if (proxyInfo) {
                    wallet.proxyInfo = proxyInfo;
                    console.log(`   IP: ${proxyInfo.ip}`);
                }
            } else {
                console.log(`   Mode: Direct IP (No Proxy)`);
                const directIP = await this.checkProxyIP(null);
                if (directIP) {
                    wallet.proxyInfo = directIP;
                    console.log(`   IP: ${directIP.ip}`);
                }
            }
            
            await this.delay(this.getRandomDelay(500, 2000));
            
            await this.retryOperation(
                this.login.bind(this),
                'Login',
                this.maxRetries,
                wallet
            );
            console.log(`   âœ… Login`);
            await this.delay(this.getRandomDelay(500, 1000));
            
            await this.retryOperation(
                this.getInfo.bind(this),
                'Get Info',
                this.maxRetries,
                wallet
            );
            console.log(`   âœ… Get Info`);
            await this.delay(this.getRandomDelay(400, 900));
            
            await this.retryOperation(
                this.markNewUser.bind(this),
                'Mark New User',
                this.maxRetries,
                wallet
            );
            console.log(`   âœ… Mark New User`);
            await this.delay(this.getRandomDelay(500, 1000));
            
            await this.retryOperation(
                this.applyReferralCode.bind(this),
                'Apply Referral',
                this.maxRetries,
                wallet,
                this.referralCode
            );
            console.log(`   âœ… Apply Referral: ${this.referralCode}`);
            await this.delay(this.getRandomDelay(400, 800));
            
            await this.retryOperation(
                this.getUserCode.bind(this),
                'Get User Code',
                this.maxRetries,
                wallet
            );
            console.log(`   âœ… Get User Code: ${wallet.userCode}`);
            await this.delay(this.getRandomDelay(400, 800));
            
            await this.retryOperation(
                this.applySuiInviteCode.bind(this),
                'Apply SUI Invite',
                this.maxRetries,
                wallet,
                this.referralCode
            );
            console.log(`   âœ… Apply SUI Invite`);
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[Batch ${batchNum} | Wallet ${walletNum}] ðŸŽ‰ SUCCESS in ${duration}s`);
            
            await this.saveWalletToCSV(wallet, 'SUCCESS');
            console.log(`   ðŸ’¾ Saved to ${this.csvFilePath}`);
            
            this.successCount++;
            this.wallets.push(wallet);
            return wallet;
            
        } catch (error) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.error(`[Batch ${batchNum} | Wallet ${walletNum}] âŒ FAILED in ${duration}s: ${error.message}`);
            
            await this.saveWalletToCSV(wallet, `FAILED: ${error.message}`);
            
            this.failCount++;
            return null;
        }
    }

    async processBatch(batchNum, walletsPerBatch) {
        console.log(`\n${'â•'.repeat(70)}`);
        console.log(`ðŸ“¦ BATCH ${batchNum} - Processing ${walletsPerBatch} wallets concurrently...`);
        console.log('â•'.repeat(70));
        
        const batchStartTime = Date.now();
        
        const promises = [];
        for (let i = 1; i <= walletsPerBatch; i++) {
            const globalWalletNum = (batchNum - 1) * walletsPerBatch + i;
            promises.push(this.processWallet(globalWalletNum, batchNum));
        }
        
        const results = await Promise.allSettled(promises);
        
        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2);
        const batchSuccess = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
        const batchFail = results.filter(r => r.status === 'rejected' || r.value === null).length;
        
        console.log(`\nðŸ“Š Batch ${batchNum} Summary:`);
        console.log(`   âœ… Success: ${batchSuccess}/${walletsPerBatch}`);
        console.log(`   âŒ Failed: ${batchFail}/${walletsPerBatch}`);
        console.log(`   â±ï¸  Duration: ${batchDuration}s`);
        console.log(`   ðŸ“ˆ Success Rate: ${((batchSuccess / walletsPerBatch) * 100).toFixed(2)}%`);
        
        return results;
    }

    async runMultipleBatches(numBatches, walletsPerBatch) {
        const totalWallets = numBatches * walletsPerBatch;
        
        console.log(`\n${'â•'.repeat(70)}`);
        console.log(`ðŸš€ STARTING MULTI-BATCH EXECUTION`);
        console.log('â•'.repeat(70));
        console.log(`ðŸ“‹ Configuration:`);
        console.log(`   Total Batches: ${numBatches}`);
        console.log(`   Wallets per Batch: ${walletsPerBatch}`);
        console.log(`   Total Wallets: ${totalWallets}`);
        console.log(`   Referral Code: ${this.referralCode}`);
        console.log(`   Proxy Mode: ${this.useProxy ? 'ENABLED âœ…' : 'DISABLED âŒ (Direct IP)'}`);
        
        if (this.useProxy) {
            console.log(`   Available Proxies: ${this.proxyList.length}`);
            if (this.proxyList.length < totalWallets) {
                console.log(`   âš ï¸  WARNING: You need ${totalWallets} proxies but only have ${this.proxyList.length}`);
                console.log(`   âš ï¸  Proxies will be reused (multiple wallets may share same IP)`);
            }
        } else {
            console.log(`   Network: Using Direct IP (No Proxy)`);
        }
        
        console.log(`   Max Retries per Step: ${this.maxRetries}`);
        console.log(`   CSV Output: ${this.csvFilePath}`);
        console.log('â•'.repeat(70));
        
        const overallStartTime = Date.now();
        
        for (let batchNum = 1; batchNum <= numBatches; batchNum++) {
            await this.processBatch(batchNum, walletsPerBatch);
            
            if (batchNum < numBatches) {
                const delayBetweenBatches = this.getRandomDelay(3000, 6000);
                console.log(`\nâ³ Waiting ${(delayBetweenBatches/1000).toFixed(1)}s before next batch...\n`);
                await this.delay(delayBetweenBatches);
            }
        }
        
        const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
        
        this.printFinalSummary(numBatches, walletsPerBatch, totalWallets, overallDuration);
        
        return this.wallets;
    }

    printFinalSummary(numBatches, walletsPerBatch, totalWallets, duration) {
        console.log(`\n${'â•'.repeat(70)}`);
        console.log(`ðŸ“Š FINAL SUMMARY`);
        console.log('â•'.repeat(70));
        console.log(`ðŸŽ¯ Referral Code Used: ${this.referralCode}`);
        console.log(`ðŸ“¦ Total Batches: ${numBatches}`);
        console.log(`ðŸ‘› Wallets per Batch: ${walletsPerBatch}`);
        console.log(`ðŸ“ˆ Total Wallets Attempted: ${totalWallets}`);
        console.log(`âœ… Successful: ${this.successCount}`);
        console.log(`âŒ Failed: ${this.failCount}`);
        console.log(`ðŸ“Š Success Rate: ${((this.successCount / totalWallets) * 100).toFixed(2)}%`);
        console.log(`â±ï¸  Total Duration: ${duration}s`);
        console.log(`âš¡ Average Time per Wallet: ${(duration / totalWallets).toFixed(2)}s`);
        console.log(`ðŸŒ Network Mode: ${this.useProxy ? 'Proxy' : 'Direct IP'}`);
        console.log(`ðŸ’¾ CSV File: ${this.csvFilePath}`);
        console.log('â•'.repeat(70));
        
        if (this.wallets.length > 0) {
            console.log(`\nâœ… All wallet details have been saved to ${this.csvFilePath}`);
            console.log(`ðŸ“ You can open the CSV file to view all wallet information`);
        }
        
        console.log(`\n${'â•'.repeat(70)}\n`);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

function loadProxies(filename = 'proxies.txt') {
    const fs = require('fs');
    try {
        if (fs.existsSync(filename)) {
            const content = fs.readFileSync(filename, 'utf-8');
            const proxies = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
            
            console.log(`âœ… Loaded ${proxies.length} proxies dari ${filename}`);
            return proxies;
        } else {
            console.log(`âš ï¸  File ${filename} tidak ditemukan.`);
            return [];
        }
    } catch (error) {
        console.error(`âŒ Error loading proxies: ${error.message}`);
        return [];
    }
}

async function main() {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\n' + 'â•'.repeat(70));
    console.log('ðŸ¤– SUI Auto Referral Bot v4.2 - FLEXIBLE PROXY EDITION');
    console.log('â•'.repeat(70));
    console.log('Features:');
    console.log('  âœ… Multi-Batch Concurrent Execution');
    console.log('  âœ… Optional Proxy Support (Choose Y/N)');
    console.log('  âœ… 1 Wallet = 1 IP (When Using Proxy)');
    console.log('  âœ… High Success Rate (5x Retry per Step)');
    console.log('  âœ… Parallel Processing within Batch');
    console.log('  âœ… IP Detection & Geolocation');
    console.log('  âœ… Random Delays (Anti-Detection)');
    console.log('  âœ… Auto Save to wallet.csv (Phrase, Private Key, Address)');
    console.log('  âœ… Comprehensive Statistics');
    console.log('â•'.repeat(70) + '\n');

    readline.question('ðŸŽ¯ Masukkan kode referral (contoh: YTEUE): ', async (referralCode) => {
        if (!referralCode || referralCode.trim().length === 0) {
            console.log('âŒ Kode referral tidak boleh kosong!');
            readline.close();
            return;
        }

        const cleanCode = referralCode.trim().toUpperCase();
        console.log(`âœ… Kode referral: ${cleanCode}`);

        readline.question('\nðŸ“¦ Berapa batch yang ingin dibuat? (contoh: 10): ', async (numBatches) => {
            const batchCount = parseInt(numBatches);
            
            if (isNaN(batchCount) || batchCount <= 0) {
                console.log('âŒ Masukkan angka yang valid!');
                readline.close();
                return;
            }

            console.log(`âœ… Jumlah batch: ${batchCount}`);

            readline.question('\nðŸ‘› Berapa wallet per batch? (contoh: 5): ', async (walletsPerBatch) => {
                const walletCount = parseInt(walletsPerBatch);
                
                if (isNaN(walletCount) || walletCount <= 0) {
                    console.log('âŒ Masukkan angka yang valid!');
                    readline.close();
                    return;
                }

                console.log(`âœ… Wallet per batch: ${walletCount}`);
                
                const totalWallets = batchCount * walletCount;
                console.log(`\nðŸ“Š Total wallet yang akan dibuat: ${totalWallets}`);
                console.log(`ðŸ“Š Konfigurasi: ${batchCount} batch Ã— ${walletCount} wallet`);

                readline.question('\nðŸŒ Apakah Anda ingin menggunakan proxy? (y/n): ', async (useProxyAnswer) => {
                    const useProxy = useProxyAnswer.toLowerCase() === 'y';
                    
                    let proxies = [];
                    
                    if (useProxy) {
                        console.log(`\nâœ… Mode: PROXY ENABLED`);
                        console.log('ðŸ“ Loading proxies...');
                        proxies = loadProxies('proxies.txt');
                        
                        if (proxies.length === 0) {
                            console.log('âŒ Tidak ada proxy yang tersedia di proxies.txt!');
                            console.log('ðŸ’¡ Buat file proxies.txt dengan format:');
                            console.log('   http://username:password@ip:port');
                            readline.close();
                            return;
                        }
                        
                        if (proxies.length >= totalWallets) {
                            console.log(`âœ… ${proxies.length} proxy tersedia (cukup untuk ${totalWallets} wallet)`);
                        } else {
                            console.log(`âš ï¸  ${proxies.length} proxy tersedia (kurang dari ${totalWallets} wallet)`);
                            console.log(`âš ï¸  Beberapa IP akan digunakan ulang`);
                        }
                    } else {
                        console.log(`\nâœ… Mode: DIRECT IP (No Proxy)`);
                        console.log('ðŸŒ Bot akan menggunakan IP Anda langsung');
                    }

                    readline.question('\nâ–¶ï¸  Lanjutkan? (y/n): ', async (confirm) => {
                        if (confirm.toLowerCase() !== 'y') {
                            console.log('âŒ Dibatalkan oleh user');
                            readline.close();
                            return;
                        }

                        console.log(`\nâ³ Starting execution...\n`);
                        
                        const bot = new SuiReferralBot(cleanCode, proxies, useProxy);
                        await bot.runMultipleBatches(batchCount, walletCount);
                        
                        readline.close();
                    });
                });
            });
        });
    });
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = SuiReferralBot;
