import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://dhqbfmdbclbhkonobdmt.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_LnhjgDW5YKc-pqvZ_p7ePg_v2GQl7Gw";

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);