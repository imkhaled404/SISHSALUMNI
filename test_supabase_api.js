const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://iwevvgvsdxurotzsibvr.supabase.co';
const supabaseKey = 'sb_publishable_8eXo3szEYs00OjinkFFO2g_Um_y0IWy';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log("Testing Supabase API connection...");
    try {
        const { data, error } = await supabase.from('members').select('*').limit(1);
        if (error) throw error;
        console.log("SUCCESS! API Reachable.");
        console.log("Data sample:", data);
    } catch (e) {
        console.error("API FAILED!");
        console.error("Message:", e.message);
    }
}

test();
