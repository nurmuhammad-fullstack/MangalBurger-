-- =====================================================
-- RLS POLICIES: clean + recreate (idempotent)
-- =====================================================

-- Enable RLS
ALTER TABLE public.menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- -----------------
-- menu (public read)
-- -----------------
DROP POLICY IF EXISTS "menu_select" ON public.menu;
DROP POLICY IF EXISTS "menu_public_select_available" ON public.menu;
DROP POLICY IF EXISTS "Menyu ochiq korish" ON public.menu;
DROP POLICY IF EXISTS "menu_select" ON public.menu;
DROP POLICY IF EXISTS "menu_admin" ON public.menu;
DROP POLICY IF EXISTS "Faqat admin yoza oladi" ON public.menu;

-- keep one policy for public read
CREATE POLICY "menu_public_select_available" ON public.menu
  FOR SELECT TO PUBLIC
  USING (is_available = true);

-- -----------------
-- orders (auth insert + auth select)
-- -----------------
DROP POLICY IF EXISTS "orders_insert" ON public.orders;
DROP POLICY IF EXISTS "orders_auth_insert" ON public.orders;
DROP POLICY IF EXISTS "orders_auth_select" ON public.orders;
DROP POLICY IF EXISTS "orders_select_service" ON public.orders;
DROP POLICY IF EXISTS "orders_update_service" ON public.orders;
DROP POLICY IF EXISTS "Orders faqat service_role" ON public.orders;

CREATE POLICY "orders_auth_insert" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "orders_auth_select" ON public.orders
  FOR SELECT TO authenticated
  USING (true);

-- -----------------
-- order_items (auth insert + auth select)
-- -----------------
DROP POLICY IF EXISTS "items_insert" ON public.order_items;
DROP POLICY IF EXISTS "order_items_auth_insert" ON public.order_items;
DROP POLICY IF EXISTS "order_items_auth_select" ON public.order_items;
DROP POLICY IF EXISTS "items_select_service" ON public.order_items;
DROP POLICY IF EXISTS "Order items faqat service_role" ON public.order_items;

CREATE POLICY "order_items_auth_insert" ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "order_items_auth_select" ON public.order_items
  FOR SELECT TO authenticated
  USING (true);

-- -----------------
-- storage.objects (menu-images bucket)
-- -----------------
DROP POLICY IF EXISTS "storage_public" ON storage.objects;
DROP POLICY IF EXISTS "storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "storage_public" ON storage.objects;

DROP POLICY IF EXISTS "menu_images_public_select" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_auth_delete" ON storage.objects;

DROP POLICY IF EXISTS "Faqat admin rasm yuklaydi" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_public_select" ON storage.objects;
DROP POLICY IF EXISTS "Bot session faqat service_role" ON storage.objects;
DROP POLICY IF EXISTS "Users faqat service_role" ON storage.objects;
DROP POLICY IF EXISTS "Order items faqat service_role" ON storage.objects;
DROP POLICY IF EXISTS "Orders faqat service_role" ON storage.objects;

-- Public read images
CREATE POLICY "menu_images_public_select" ON storage.objects
  FOR SELECT TO PUBLIC
  USING (bucket_id = 'menu-images');

-- Authenticated can upload/update/delete in bucket
CREATE POLICY "menu_images_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'menu-images');

CREATE POLICY "menu_images_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'menu-images')
  WITH CHECK (bucket_id = 'menu-images');

CREATE POLICY "menu_images_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'menu-images');
