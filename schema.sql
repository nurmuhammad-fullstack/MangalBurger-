-- =====================================================
-- MANGAL BURGER — Supabase SQL Schema v2
-- Supabase → SQL Editor ga joylashtiring → Run
-- =====================================================

-- 1. MENU JADVALI
-- =====================================================
CREATE TABLE IF NOT EXISTS public.menu (
  id           SERIAL PRIMARY KEY,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  title        TEXT NOT NULL,
  price        NUMERIC(12, 0) NOT NULL,
  description  TEXT,
  category     TEXT NOT NULL,
  image_url    TEXT,
  is_available BOOLEAN DEFAULT TRUE
);

-- 2. BUYURTMALAR JADVALI
-- =====================================================
CREATE TABLE IF NOT EXISTS public.orders (
  id           SERIAL PRIMARY KEY,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  total_price     NUMERIC(12, 0) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'yangi',
  -- status qiymatlari: yangi | tayyorlanmoqda | yetkazilmoqda | yetkazildi | bekor
  note         TEXT
);

-- 3. BUYURTMA TARKIBI JADVALI
-- =====================================================
CREATE TABLE IF NOT EXISTS public.order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_id    INTEGER NOT NULL REFERENCES public.menu(id),
  title      TEXT NOT NULL,
  price      NUMERIC(12, 0) NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 1
);

-- 4. INDEKSLAR
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_menu_category    ON public.menu(category);
CREATE INDEX IF NOT EXISTS idx_menu_available   ON public.menu(is_available);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created   ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_order_id   ON public.order_items(order_id);

-- 5. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.menu         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items  ENABLE ROW LEVEL SECURITY;

-- Menu: hamma o'qiy oladi
CREATE POLICY "menu_select"
  ON public.menu FOR SELECT USING (is_available = TRUE);

-- Orders: hamma yoza oladi (buyurtma berish), service_role o'qiydi
CREATE POLICY "orders_insert"
  ON public.orders FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "orders_select_service"
  ON public.orders FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "orders_update_service"
  ON public.orders FOR UPDATE USING (auth.role() = 'service_role');

-- Order items: hamma yoza oladi
CREATE POLICY "items_insert"
  ON public.order_items FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "items_select_service"
  ON public.order_items FOR SELECT USING (auth.role() = 'service_role');

-- 6. REALTIME (bot uchun)
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

-- 7. STORAGE BUCKET
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_public" 
  ON storage.objects FOR ALL 
  USING (bucket_id = 'menu-images')
  WITH CHECK (bucket_id = 'menu-images');

CREATE POLICY "storage_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'menu-images');

-- 8. DEMO MENU MA'LUMOTLARI
-- =====================================================
INSERT INTO public.menu (title, price, description, category, image_url) VALUES
  ('Klassik Burger',   35000, 'Mol go''shti, salat, pomidor va maxsus sous bilan.',         'Burgerlar',   'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400'),
  ('Mangal Burger',    45000, 'Mangalda pishirilgan go''sht, karamelized piyoz bilan.',      'Burgerlar',   'https://images.unsplash.com/photo-1550317138-10000687a72b?w=400'),
  ('Tovuq Burger',     32000, 'Qovurilgan tovuq, coleslaw va achchiq sous bilan.',           'Burgerlar',   'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=400'),
  ('Kartoshka fri',    15000, 'Tuz va paprika bilan qovurilgan kartoshka.',                  'Garniturlar', 'https://images.unsplash.com/photo-1630384060421-cb20d0e0649d?w=400'),
  ('Onion rings',      18000, 'Qoplayda qovurilgan halqali piyoz.',                          'Garniturlar', 'https://images.unsplash.com/photo-1639024471283-03518883512d?w=400'),
  ('Kola',             10000, 'Sovutilgan Coca-Cola 0.5L.',                                  'Ichimliklar', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400'),
  ('Lemonad',          12000, 'Uy limonadi, limon va nanadan tayyorlangan.',                 'Ichimliklar', 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=400'),
  ('Cheez burger',     38000, 'Ikki qatlam pishloq va mol go''shti.',                        'Burgerlar',   'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400');

-- =====================================================
-- FOYDALI SO'ROVLAR
-- =====================================================
-- Barcha yangi buyurtmalar:
--   SELECT o.*, oi.title, oi.quantity, oi.price
--   FROM orders o JOIN order_items oi ON o.id = oi.order_id
--   WHERE o.status = 'yangi' ORDER BY o.created_at DESC;
--
-- Buyurtma statusini o'zgartirish:
--   UPDATE orders SET status = 'tayyorlanmoqda' WHERE id = 1;
