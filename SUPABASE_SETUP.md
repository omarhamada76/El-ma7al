# إعداد Supabase — Vet Pharmacy Dashboard

## الخطوة 1: تشغيل الـ Schema في Supabase

1. افتح مشروعك في [Supabase Dashboard](https://supabase.com/dashboard).
2. من القائمة الجانبية اختر **SQL Editor**.
3. انسخ محتوى الملف **`supabase/schema.sql`** والصقه في المحرر.
4. اضغط **Run** (أو Ctrl+Enter).
5. تأكد من عدم ظهور أخطاء؛ سيتم إنشاء الجداول وبذرة المخازن (اجهور، شبرا).

---

## الخطوة 2: تفعيل صلاحيات الجداول (RLS)

بعد تشغيل الـ schema، نفّذ الملف **`supabase/rls-policies.sql`** في SQL Editor حتى يتمكن المستخدمون المسجّلون من القراءة والكتابة على الجداول.

---

## الخطوة 3: ربط Supabase Auth بجدول المستخدمين (اختياري لكن مُفضّل)

بعد تشغيل الـ schema الأساسي، نفّذ الكود التالي في **SQL Editor** مرة واحدة:

```sql
-- إنشاء مستخدم في جدول users عند تسجيل مستخدم جديد في Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, auth_id, email, display_name, role)
  VALUES (
    new.id,
    new.id::text,
    new.email,
    COALESCE(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name'),
    COALESCE(new.raw_user_meta_data->>'role', 'staff')
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- الربط مع حدث الإدراج في auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

بهذا عند أي تسجيل جديد من الواجهة سيُضاف سطر في `public.users` تلقائياً.

---

## الخطوة 4: الحصول على المفاتيح (URL و Anon Key)

1. في Supabase Dashboard اختر **Project Settings** (أيقونة الترس).
2. من القائمة الجانبية اختر **API**.
3. انسخ:
   - **Project URL** (مثل `https://xxxxx.supabase.co`)
   - **anon public** key (تحت "Project API keys")

---

## الخطوة 5: إعداد متغيرات البيئة في المشروع

1. في جذر المشروع أنشئ ملفاً اسمه **`.env`** (بجانب `package.json`).
2. أضف السطرين التاليين واستبدل القيم بقيم مشروعك:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

3. احفظ الملف. **لا ترفع `.env` إلى Git** (موجود عادة في `.gitignore`).

---

## الخطوة 6: تفعيل الدخول عبر Supabase في الواجهة

بعد إضافة `.env` وتشغيل:

```bash
npm install
npm run dev
```

ستستخدم الواجهة Supabase للتسجيل والدخول عندما تكون `VITE_SUPABASE_URL` معرّفة.  
إذا أردت العودة للتجربة بدون خادم، احذف أو علّق سطرَي `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` من `.env`.

---

## ملخص الترتيب

| # | الخطوة |
|---|--------|
| 1 | تشغيل `supabase/schema.sql` في SQL Editor |
| 2 | تشغيل `supabase/rls-policies.sql` في SQL Editor |
| 3 | (اختياري) تشغيل `supabase/schema-supabase-auth.sql` لربط Auth بجدول `users` |
| 4 | نسخ Project URL و anon key من Project Settings → API |
| 5 | إنشاء `.env` وإضافة `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` |
| 6 | تشغيل `npm run dev` واستخدام الدخول عبر Supabase |

---

## إنشاء أول مستخدم (تسجيل الدخول)

- من **Supabase Dashboard** → **Authentication** → **Users** → **Add user** → أدخل البريد وكلمة المرور ثم **Create user**.
- أو استخدم **Sign up** من الواجهة إذا أضفت صفحة تسجيل لاحقاً.

لجعل أول مستخدم مشرفاً: بعد إنشائه نفّذ في SQL Editor (استبدل `USER_UUID` بمعرّف المستخدم من جدول Authentication):

```sql
UPDATE public.users SET role = 'super_admin' WHERE id = 'USER_UUID';
```
