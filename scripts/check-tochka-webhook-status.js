require('dotenv').config();
const axios = require('axios');

const TOCHKA_API_KEY = process.env.TOCHKA_API_KEY;
const TOCHKA_CLIENT_ID = process.env.TOCHKA_CLIENT_ID;

async function checkWebhookStatus() {
    try {
        console.log('🔍 Проверяю статус webhook в Точка Банке...\n');
        console.log(`   Client ID: ${TOCHKA_CLIENT_ID}`);
        console.log(`   Callback URL: ${process.env.PAYMENT_CALLBACK_URL}\n`);
        
        const url = `https://enter.tochka.com/uapi/webhook/v1.0/${TOCHKA_CLIENT_ID}`;
        
        console.log(`📤 GET ${url}\n`);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${TOCHKA_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ Webhook зарегистрирован:');
        console.log(JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        if (error.response) {
            console.error('❌ Ошибка:', error.response.status);
            console.error('   Ответ:', JSON.stringify(error.response.data, null, 2));
            
            if (error.response.status === 404) {
                console.log('\n⚠️ Webhook НЕ зарегистрирован!');
                console.log('   Необходимо зарегистрировать webhook с помощью:');
                console.log('   node scripts/register-tochka-webhook.js');
            }
        } else {
            console.error('❌ Ошибка:', error.message);
        }
    }
}

checkWebhookStatus();

