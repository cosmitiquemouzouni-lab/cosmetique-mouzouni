import { useEffect, useMemo, useState } from 'react'
import Swal from 'sweetalert2'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import {
  addDoc, collection, deleteDoc, doc, increment, onSnapshot, orderBy,
  query, serverTimestamp, updateDoc, writeBatch,
} from 'firebase/firestore'
import {
  BadgeCheck, Boxes, CalendarDays, CheckCircle2, Edit3, Eye, Heart,
  EyeOff, Home, Menu, MessageCircle, Moon, Phone, Plus,
  Search, ShoppingBag, ShoppingCart, Sparkles, Star, Sun, Trash2, Truck,
  UserRound, X,
} from 'lucide-react'
import { auth, db, firebaseReady } from './firebase'
import brandLogo from './assets/logo mouzouni.jpeg'
import './App.css'

const CASA_NAMES = ['casa', 'casablanca', 'الدار البيضاء', 'كازا']
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const FIREBASE_STORAGE_BUCKET = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
const FALLBACK_PRODUCT_IMAGE = brandLogo

function extractImageUrl(value) {
  const text = String(value || '').trim()
  const cloudinaryMatch = text.match(/https?:\/\/res\.cloudinary\.com\/[^\s"'<>]+/i)
  if (cloudinaryMatch?.[0]) return cloudinaryMatch[0]
  const imageMatch = text.match(/https?:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i)
  return imageMatch?.[0] || text
}

function normalizeImageUrl(value) {
  const url = extractImageUrl(value)
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  if (/^res\.cloudinary\.com\//i.test(url)) return `https://${url}`
  if (/^products\//i.test(url)) {
    if (CLOUDINARY_CLOUD_NAME) return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${url}`
    if (FIREBASE_STORAGE_BUCKET) return `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(url)}?alt=media`
    return ''
  }
  if (!/^https?:\/\//i.test(url)) {
    if (/^(www\.|images\.|res\.)/i.test(url)) return `https://${url}`
    return ''
  }
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'products') return ''
  } catch {
    return ''
  }
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  if (driveMatch?.[1]) return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`
  return url
}

function isValidDirectImageUrl(value) {
  const url = normalizeImageUrl(value)
  return /^https:\/\/.+/i.test(url)
}

function imageFallback(event) {
  if (event.currentTarget.dataset.fallback === 'true') return
  event.currentTarget.dataset.fallback = 'true'
  event.currentTarget.src = FALLBACK_PRODUCT_IMAGE
}

function syncCartItemWithProducts(item, products) {
  const current = products.find((product) => product.id === item.id) ||
    products.find((product) => product.name === item.name)
  if (!current) return item
  const stock = Number(current.stock || item.stock || 1)
  return {
    ...item,
    id: current.id,
    name: current.name,
    description: current.description,
    image: normalizeImageUrl(current.image),
    oldPrice: current.oldPrice || '',
    price: Number(current.price),
    stock,
    quantity: Math.max(1, Math.min(Number(item.quantity || 1), stock || 1)),
  }
}

function uniqueById(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

const demoProducts = [
  { id: 'demo-1', name: 'شامبو مغذ للشعر', description: 'تركيبة لطيفة تمنح الشعر لمعانا ونعومة وتساعد على العناية اليومية.', image: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=80', oldPrice: 149, price: 119, stock: 12 },
  { id: 'demo-2', name: 'سيروم البروتين', description: 'سيروم مركز للشعر المتعب، مناسب للاستعمال بعد الاستحمام وقبل التصفيف.', image: 'https://images.unsplash.com/photo-1617897903246-719242758050?auto=format&fit=crop&w=900&q=80', oldPrice: 220, price: 169, stock: 7 },
  { id: 'demo-3', name: 'كريم ترطيب فاخر', description: 'كريم يومي بقوام ناعم يساعد البشرة على الحفاظ على ترطيبها وإشراقتها.', image: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=900&q=80', oldPrice: '', price: 89, stock: 0 },
]

const reviews = [
  { name: 'سلمى من الدار البيضاء', text: 'الطلب وصل بسرعة والمنتجات أصلية فعلا. أكثر شيء أعجبني هو العناية في التغليف.' },
  { name: 'مريم من الرباط', text: 'جربت سيروم البروتين والنتيجة ظهرت من أول أسبوع. تعامل راق وخدمة ممتازة.' },
  { name: 'نادية من طنجة', text: 'أسعار مناسبة مقارنة بالجودة، والرد في واتساب كان سريع وواضح.' },
  { name: 'هند من مراكش', text: 'أحببت أن المخزون واضح قبل الطلب، وكل شيء وصل كما في الصور.' },
]

const emptyProduct = { name: '', description: '', image: '', oldPrice: '', price: '', stock: '' }

function formatPrice(value) {
  return Number(value || 0).toLocaleString('ar-MA')
}

function discountOf(product) {
  const oldPrice = Number(product.oldPrice)
  const newPrice = Number(product.price)
  if (!oldPrice || !newPrice || oldPrice <= newPrice) return 0
  return Math.round(((oldPrice - newPrice) / oldPrice) * 100)
}

function shippingFor(city) {
  return CASA_NAMES.includes(String(city || '').trim().toLowerCase()) ? 20 : 30
}

function Logo() {
  return (
    <a className="logo" href="#home" aria-label="Cosmetique Mouzouni">
      <span className="logoMark"><img src={brandLogo} alt="" /></span>
      <span><strong>Cosmetique Mouzouni</strong><small>جمال أصلي بثقة</small></span>
    </a>
  )
}

export default function App() {
  const [route, setRoute] = useState('home')
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [products, setProducts] = useState(firebaseReady ? [] : demoProducts)
  const [orders, setOrders] = useState([])
  const [cart, setCart] = useState(() => JSON.parse(localStorage.getItem('cart') || '[]'))
  const [search, setSearch] = useState('')
  const [admin, setAdmin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => localStorage.setItem('cart', JSON.stringify(cart)), [cart])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [route, selectedProduct?.id])

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, (user) => {
      setAdmin(Boolean(user))
      if (!user) setOrders([])
      localStorage.setItem('admin', user ? 'true' : 'false')
    })
  }, [])

  useEffect(() => {
    if (!firebaseReady) return undefined
    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), orderBy('createdAt', 'desc')),
      (snap) => {
        const list = snap.docs.map((item) => ({ id: item.id, ...item.data() }))
        setProducts(uniqueById(list))
      },
      () => Swal.fire('تنبيه', 'تعذر تحميل المنتجات. تحقق من إعدادات الموقع.', 'warning'),
    )
    return () => {
      unsubProducts()
    }
  }, [])

  useEffect(() => {
    if (!firebaseReady || !admin) return undefined
    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
      (snap) => setOrders(uniqueById(snap.docs.map((item) => ({ id: item.id, ...item.data() })))),
      () => Swal.fire('تنبيه', 'تعذر تحميل الطلبات. تحقق من صلاحيات الإدارة.', 'warning'),
    )
    return () => unsubOrders()
  }, [admin])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q))
  }, [products, search])

  const syncedCart = useMemo(
    () => cart.map((item) => syncCartItemWithProducts(item, products)),
    [cart, products],
  )

  function addToCart(product, quantity = 1) {
    const stock = Number(product.stock || 0)
    if (stock <= 0) return Swal.fire('غير متوفر', 'هذا المنتج غير متوفر حاليا في المخزون.', 'info')
    const addQuantity = Math.max(1, Math.min(Number(quantity || 1), stock))
    setCart((items) => {
      const existing = items.find((item) => item.id === product.id)
      if (existing) {
        if (existing.quantity + addQuantity > stock) {
          Swal.fire('تنبيه', 'لا يمكن تجاوز الكمية المتوفرة في المخزون.', 'warning')
          return items
        }
        return items.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + addQuantity } : item)
      }
      return [...items, { ...product, image: normalizeImageUrl(product.image), price: Number(product.price), quantity: addQuantity }]
    })
    Swal.fire({ icon: 'success', title: 'تمت الإضافة إلى السلة', timer: 1000, showConfirmButton: false })
  }

  function updateCart(id, quantity) {
    const product = products.find((p) => p.id === id)
    const safeQuantity = Math.max(1, Math.min(Number(quantity), Number(product?.stock || 1)))
    setCart((items) => items.map((item) => item.id === id ? { ...item, quantity: safeQuantity } : item))
  }

  async function submitOrder(customer) {
    if (!syncedCart.length) return Swal.fire('السلة فارغة', 'أضف منتجا واحدا على الأقل قبل إتمام الطلب.', 'info')
    const unavailable = syncedCart.find((item) => item.quantity > Number(products.find((p) => p.id === item.id)?.stock || 0))
    if (unavailable) return Swal.fire('المخزون تغير', `الكمية المطلوبة من ${unavailable.name} غير متوفرة حاليا.`, 'warning')

    const shipping = shippingFor(customer.city)
    const subtotal = syncedCart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0)
    const order = {
      customer,
      items: syncedCart.map(({ id, name, price, image, quantity }) => ({ id, name, price: Number(price), image, quantity })),
      subtotal,
      shipping,
      total: subtotal + shipping,
      status: 'new',
      stockRestored: false,
      createdAt: serverTimestamp(),
      createdAtText: new Date().toLocaleString('ar-MA'),
    }

    if (firebaseReady) {
      const batch = writeBatch(db)
      const orderRef = doc(collection(db, 'orders'))
      batch.set(orderRef, order)
      syncedCart.forEach((item) => batch.update(doc(db, 'products', item.id), { stock: increment(-item.quantity) }))
      await batch.commit()
    }

    setCart([])
    Swal.fire({ icon: 'success', title: 'تم إرسال الطلب بنجاح', text: 'سنتواصل معك لتأكيد الطلب.' })
  }

  return (
    <div>
      <header className="siteHeader">
        <Logo />
        <nav className={menuOpen ? 'open' : ''}>
          <button onClick={() => { setRoute('home'); setMenuOpen(false) }}><Home size={18} /> الرئيسية</button>
          <button onClick={() => { setRoute('reviews'); setMenuOpen(false) }}><Star size={18} /> آراء العملاء</button>
          <button onClick={() => { setRoute('about'); setMenuOpen(false) }}><Sparkles size={18} /> من نحن</button>
        </nav>
        <div className="headerActions">
          <button className="iconBtn" onClick={() => setDark(!dark)} aria-label="تغيير المظهر">{dark ? <Sun /> : <Moon />}</button>
          <button className="cartButton" onClick={() => setRoute('cart')}><ShoppingCart size={18} /><span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span></button>
          <button className="iconBtn menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="القائمة"><Menu /></button>
        </div>
      </header>
      {route === 'home' && <HomePage products={filteredProducts} search={search} setSearch={setSearch} addToCart={addToCart} openDetail={(product) => { setSelectedProduct(product); setRoute('product') }} />}
      {route === 'product' && <ProductDetail product={selectedProduct} products={products} addToCart={addToCart} backHome={() => setRoute('home')} />}
      {route === 'cart' && <CartPage cart={syncedCart} products={products} updateCart={updateCart} removeFromCart={(id) => setCart((items) => items.filter((item) => item.id !== id))} submitOrder={submitOrder} />}
      {route === 'reviews' && <ReviewsPage />}
      {route === 'about' && <AboutPage />}
      {route === 'admin' && (admin ? <AdminPage products={products} orders={orders} setAdmin={setAdmin} setProducts={setProducts} /> : <AdminLogin />)}
      <Footer openAdmin={() => setRoute('admin')} />
    </div>
  )
}

function HomePage({ products, search, setSearch, addToCart, openDetail }) {
  return (
    <main id="home">
      <section className="hero">
        <div className="heroCopy">
          <span className="eyebrow"><BadgeCheck size={18} /> منتجات أصلية بعناية مغربية</span>
          <h1>Cosmetique Mouzouni</h1>
          <p>منتجات عناية أصلية للشعر والبشرة، بأسعار واضحة وتوصيل سريع داخل المغرب.</p>
          <div className="heroActions">
            <a className="primary" href="#products"><ShoppingBag size={19} /> تسوق الآن</a>
          </div>
        </div>
        <div className="heroVisual" aria-hidden="true">
          <img src={brandLogo} alt="" />
        </div>
      </section>
      <section className="productsHead" id="products">
        <div><span className="eyebrow"><Sparkles size={17} /> المنتجات</span><h2>اختيارات العناية المتوفرة</h2></div>
        <label className="searchBox"><Search size={19} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن منتج..." /></label>
      </section>
      <section className="productGrid">
        {products.map((product) => <ProductCard key={product.id} product={product} addToCart={addToCart} openDetail={openDetail} />)}
      </section>
    </main>
  )
}

function ProductCard({ product, addToCart, openDetail }) {
  const discount = discountOf(product)
  const inStock = Number(product.stock || 0) > 0
  return (
    <article className="productCard">
      <button className="productImage" onClick={() => openDetail(product)} aria-label={`تفاصيل ${product.name}`}>
        <img src={normalizeImageUrl(product.image) || FALLBACK_PRODUCT_IMAGE} alt={product.name} onError={imageFallback} />
        {discount > 0 && <span className="discount">-{discount}%</span>}
      </button>
      <div className="productBody">
        <div className="stockLine"><span className={inStock ? 'stock in' : 'stock out'}>{inStock ? 'متوفر' : 'نفد المخزون'}</span><small>{Number(product.stock || 0)} قطعة</small></div>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        <div className="priceRow"><strong>{formatPrice(product.price)} درهم</strong>{product.oldPrice && Number(product.oldPrice) > Number(product.price) && <del>{formatPrice(product.oldPrice)} درهم</del>}</div>
        <button className="primary full" disabled={!inStock} onClick={() => addToCart(product)}><ShoppingCart size={18} /> أضف إلى السلة</button>
      </div>
    </article>
  )
}

function ProductDetail({ product, products, addToCart, backHome }) {
  const currentProduct = products.find((item) => item.id === product?.id) || product
  const [quantity, setQuantity] = useState(1)

  if (!currentProduct) {
    return (
      <main className="page">
        <div className="empty">المنتج غير موجود.</div>
        <button className="primary" onClick={backHome}>الرجوع للمنتجات</button>
      </main>
    )
  }

  const stock = Number(currentProduct.stock || 0)
  const inStock = stock > 0
  const discount = discountOf(currentProduct)
  const safeQuantity = Math.max(1, Math.min(Number(quantity || 1), stock || 1))

  function setSafeQuantity(value) {
    setQuantity(Math.max(1, Math.min(Number(value || 1), stock || 1)))
  }

  function addSelectedQuantity() {
    addToCart(currentProduct, safeQuantity)
  }

  return (
    <main className="page productDetail">
      <button className="ghost backButton" onClick={backHome}>الرجوع للمنتجات</button>
      <section className="detailGrid">
        <div className="detailImage">
          <img src={normalizeImageUrl(currentProduct.image) || FALLBACK_PRODUCT_IMAGE} alt={currentProduct.name} onError={imageFallback} />
          {discount > 0 && <span className="discount">-{discount}%</span>}
        </div>
        <div className="panel detailInfo">
          <span className={inStock ? 'stock in' : 'stock out'}>{inStock ? 'متوفر' : 'نفد المخزون'}</span>
          <h1>{currentProduct.name}</h1>
          <p>{currentProduct.description}</p>
          <div className="priceRow detailPrice">
            <strong>{formatPrice(currentProduct.price)} درهم</strong>
            {currentProduct.oldPrice && Number(currentProduct.oldPrice) > Number(currentProduct.price) && <del>{formatPrice(currentProduct.oldPrice)} درهم</del>}
          </div>
          <small>{stock} قطعة متوفرة</small>
          <div className="qtyControl detailQty">
            <button type="button" onClick={() => setSafeQuantity(safeQuantity - 1)} disabled={safeQuantity <= 1}>-</button>
            <input type="number" min="1" max={stock || 1} value={safeQuantity} onChange={(event) => setSafeQuantity(event.target.value)} />
            <button type="button" onClick={() => setSafeQuantity(safeQuantity + 1)} disabled={safeQuantity >= stock}>+</button>
          </div>
          <button className="primary full" disabled={!inStock} onClick={addSelectedQuantity}>
            <ShoppingCart size={18} /> أضف إلى السلة
          </button>
        </div>
      </section>
    </main>
  )
}

function CartPage({ cart, products, updateCart, removeFromCart, submitOrder }) {
  const [form, setForm] = useState({ fullName: '', phone: '', cityChoice: 'الدار البيضاء', otherCity: '', address: '' })
  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0)
  const selectedCity = form.cityChoice === 'other' ? form.otherCity : form.cityChoice
  const shipping = shippingFor(selectedCity)

  function onSubmit(event) {
    event.preventDefault()
    if (!form.fullName || !form.phone || !selectedCity || !form.address) return Swal.fire('معلومات ناقصة', 'المرجو ملء الاسم الكامل، الهاتف، المدينة والعنوان.', 'warning')
    submitOrder({ fullName: form.fullName, phone: form.phone, city: selectedCity, address: form.address })
  }

  return (
    <main className="page cartLayout">
      <section>
        <span className="eyebrow"><ShoppingCart size={18} /> السلة</span>
        <h1>راجع الطلب</h1>
        <div className="cartList">
          {!cart.length && <div className="empty">السلة فارغة حاليا.</div>}
          {cart.map((item) => {
            const syncedItem = syncCartItemWithProducts(item, products)
            const max = Number(syncedItem.stock || 1)
            const itemImage = normalizeImageUrl(syncedItem.image) || FALLBACK_PRODUCT_IMAGE
            return (
              <div className="cartItem" key={item.id}>
                <img src={itemImage} alt={syncedItem.name} onError={imageFallback} />
                <div><h3>{syncedItem.name}</h3><p>{formatPrice(syncedItem.price)} درهم</p></div>
                <div className="qtyControl">
                  <button type="button" onClick={() => updateCart(syncedItem.id, syncedItem.quantity - 1)} disabled={syncedItem.quantity <= 1}>-</button>
                  <input type="number" min="1" max={max} value={syncedItem.quantity} onChange={(e) => updateCart(syncedItem.id, e.target.value)} />
                  <button type="button" onClick={() => updateCart(syncedItem.id, syncedItem.quantity + 1)} disabled={syncedItem.quantity >= max}>+</button>
                </div>
                <button className="iconBtn danger" onClick={() => removeFromCart(syncedItem.id)}><Trash2 /></button>
              </div>
            )
          })}
        </div>
      </section>
      <aside className="panel checkout">
        <h2>معلومات التوصيل</h2>
        <form onSubmit={onSubmit}>
          <input placeholder="الاسم الكامل" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <input placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select value={form.cityChoice} onChange={(e) => setForm({ ...form, cityChoice: e.target.value, otherCity: '' })}>
            <option value="الدار البيضاء">الدار البيضاء</option>
            <option value="other">مدينة أخرى</option>
          </select>
          {form.cityChoice === 'other' && <input placeholder="اكتب المدينة" value={form.otherCity} onChange={(e) => setForm({ ...form, otherCity: e.target.value })} />}
          <textarea placeholder="العنوان الكامل" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="summary">
            <span>ثمن المنتجات <strong>{formatPrice(subtotal)} درهم</strong></span>
            <span>التوصيل <strong>{shipping} درهم</strong></span>
            <span className="total">المجموع <strong>{formatPrice(subtotal + shipping)} درهم</strong></span>
          </div>
          <button className="primary full"><CheckCircle2 size={18} /> تأكيد الطلب</button>
        </form>
      </aside>
    </main>
  )
}

function ReviewsPage() {
  return (
    <main className="page">
      <span className="eyebrow"><Star size={18} /> آراء العملاء</span>
      <h1>تجارب جميلة من عميلاتنا</h1>
      <section className="reviewsGrid">
        {reviews.map((review) => <article className="reviewCard" key={review.name}><div className="stars">{Array.from({ length: 5 }).map((_, index) => <Star key={index} size={17} fill="currentColor" />)}</div><p>“{review.text}”</p><strong>{review.name}</strong></article>)}
      </section>
    </main>
  )
}

function AboutPage() {
  return (
    <main className="page about">
      <section>
        <span className="eyebrow"><Heart size={18} /> من نحن</span>
        <h1>نختار لك منتجات أصلية لأن جمالك يستحق الثقة</h1>
        <p>Cosmetique Mouzouni متجر مغربي لمنتجات العناية والتجميل، نختار منتجات أصلية بعناية ونقدم تجربة طلب سهلة وواضحة.</p>
        <p>هدفنا أن يجد العميل منتجا مناسبا بثقة، مع خدمة محترمة وجودة تليق بروتين العناية اليومي.</p>
      </section>
      <div className="aboutPanel">
        <div><BadgeCheck /><strong>منتجات أصلية</strong><span>اختيار بعناية وجودة موثوقة.</span></div>
        <div><Truck /><strong>توصيل سريع</strong><span>20 درهم في الدار البيضاء و30 درهم لباقي المدن.</span></div>
        <div><MessageCircle /><strong>متابعة الطلب</strong><span>تأكيد سريع وخدمة واضحة بعد الطلب.</span></div>
      </div>
    </main>
  )
}

function AdminLogin() {
  const [email, setEmail] = useState(() => localStorage.getItem('adminEmail') || '')
  const [pass, setPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [remember, setRemember] = useState(() => localStorage.getItem('rememberAdmin') !== 'false')

  async function login(event) {
    event.preventDefault()
    if (!firebaseReady || !auth) {
      Swal.fire('إعدادات ناقصة', 'إعدادات الدخول غير مفعلة بعد.', 'info')
      return
    }
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
      await signInWithEmailAndPassword(auth, email, pass)
      if (remember) {
        localStorage.setItem('adminEmail', email)
        localStorage.setItem('rememberAdmin', 'true')
      } else {
        localStorage.removeItem('adminEmail')
        localStorage.setItem('rememberAdmin', 'false')
      }
      Swal.fire({ icon: 'success', title: 'تم الدخول', timer: 900, showConfirmButton: false })
    } catch {
      Swal.fire('تعذر الدخول', 'تحقق من الإيميل وكلمة المرور أو من حساب الإدارة.', 'error')
    }
  }
  return (
    <section className="adminLogin">
      <form className="panel loginCard" onSubmit={login}>
        <Logo />
        <h1>دخول الإدارة</h1>
        <p>استعمل حساب الإدارة للدخول إلى لوحة التحكم.</p>
        <input type="email" placeholder="البريد الإلكتروني" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="passwordField">
          <input type={showPass ? 'text' : 'password'} placeholder="كلمة المرور" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button type="button" className="passwordToggle" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>
            {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </label>
        <label className="rememberLogin">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>تذكر دخولي في هذا الهاتف</span>
        </label>
        <button className="primary"><UserRound size={18} /> دخول</button>
      </form>
    </section>
  )
}

function AdminPage({ products, orders, setAdmin, setProducts }) {
  const [tab, setTab] = useState('products')
  const newOrdersCount = orders.filter((order) => (order.status || 'new') === 'new').length
  return (
    <main className="page admin">
      <div className="adminHead">
        <div>
          <span className="eyebrow"><Boxes size={18} /> لوحة الإدارة</span>
          <h1>إدارة المنتجات والطلبات</h1>
          {!firebaseReady && <p className="notice">إعدادات الموقع غير مكتملة بعد. بعد تفعيلها ستعمل المنتجات والطلبات مباشرة.</p>}
        </div>
        <button className="ghost" onClick={async () => { if (auth) await signOut(auth); localStorage.removeItem('admin'); setAdmin(false) }}><X size={18} /> خروج</button>
      </div>
      <div className="tabs">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}><ShoppingBag size={18} /> المنتجات</button>
        <button className={tab === 'orders' ? 'active hasBadge' : 'hasBadge'} onClick={() => setTab('orders')}>
          <Truck size={18} /> الطلبات
          {newOrdersCount > 0 && <span className="tabBadge">{newOrdersCount}</span>}
        </button>
      </div>
      {tab === 'products' ? <ProductsAdmin products={products} setProducts={setProducts} /> : <OrdersAdmin orders={orders} />}
    </main>
  )
}

function ProductsAdmin({ products, setProducts }) {
  const [form, setForm] = useState(emptyProduct)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const filtered = products.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()))

  function editProduct(product) {
    setEditingId(product.id)
    setForm({ name: product.name || '', description: product.description || '', image: product.image || '', oldPrice: product.oldPrice || '', price: product.price || '', stock: product.stock ?? '' })
  }

  async function saveProduct(event) {
    event.preventDefault()
    if (!firebaseReady) return Swal.fire('إعدادات ناقصة', 'إعدادات الحفظ غير مفعلة بعد.', 'info')
    if (!auth?.currentUser) return Swal.fire('الدخول مطلوب', 'ادخل بحساب الإدارة أولا.', 'warning')
    if (!form.name || !form.description || !form.image || !form.price) return Swal.fire('معلومات ناقصة', 'الاسم، الوصف، رابط الصورة والسعر الجديد ضرورية.', 'warning')
    if (!isValidDirectImageUrl(form.image)) return Swal.fire('رابط الصورة غير صحيح', 'استعمل رابط صورة مباشر من Cloudinary يبدأ بـ https://', 'warning')
    const payload = { name: form.name, description: form.description, image: normalizeImageUrl(form.image), price: Number(form.price), oldPrice: form.oldPrice ? Number(form.oldPrice) : '', stock: Number(form.stock || 0), updatedAt: serverTimestamp() }
    try {
      if (editingId) {
        await updateDoc(doc(db, 'products', editingId), payload)
        setProducts((items) => items.map((item) => item.id === editingId ? { ...item, ...payload } : item))
        Swal.fire('تم التعديل', 'تم تحديث المنتج بنجاح.', 'success')
      } else {
        const docRef = await addDoc(collection(db, 'products'), { ...payload, createdAt: serverTimestamp() })
        setProducts((items) => {
          const withoutDemo = items.every((item) => String(item.id).startsWith('demo-')) ? [] : items
          return uniqueById([{ id: docRef.id, ...payload, createdAt: new Date().toISOString() }, ...withoutDemo])
        })
        Swal.fire('تمت الإضافة', 'تمت إضافة المنتج بنجاح.', 'success')
      }
    } catch (error) {
      Swal.fire('لم يتم الحفظ', error?.message || 'تحقق من إعدادات الحفظ ومن حساب الإدارة.', 'error')
      return
    }
    setSearch('')
    setForm(emptyProduct)
    setEditingId(null)
  }

  async function removeProduct(id) {
    if (!firebaseReady) return Swal.fire('إعدادات ناقصة', 'إعدادات الحذف غير مفعلة بعد.', 'info')
    const result = await Swal.fire({ title: 'حذف المنتج؟', text: 'لا يمكن التراجع عن هذه العملية.', icon: 'warning', showCancelButton: true, confirmButtonText: 'نعم، حذف', cancelButtonText: 'إلغاء' })
    if (result.isConfirmed) {
      await deleteDoc(doc(db, 'products', id))
      setProducts((items) => items.filter((item) => item.id !== id))
      Swal.fire('تم الحذف', 'تم حذف المنتج.', 'success')
    }
  }

  return (
    <section className="adminGrid">
      <form className="panel productForm" onSubmit={saveProduct}>
        <h2>{editingId ? 'تعديل منتج' : 'إضافة منتج'}</h2>
        <input placeholder="اسم المنتج" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <textarea placeholder="وصف المنتج" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input
          placeholder="رابط الصورة من Cloudinary"
          value={form.image}
          onChange={(e) => setForm({ ...form, image: e.target.value })}
          onBlur={(e) => setForm({ ...form, image: normalizeImageUrl(e.target.value) })}
        />
        <div className="two">
          <input type="number" placeholder="السعر القديم اختياري" value={form.oldPrice} onChange={(e) => setForm({ ...form, oldPrice: e.target.value })} />
          <input type="number" placeholder="السعر الجديد" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <input type="number" placeholder="المخزون" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
        <button className="primary full"><Plus size={18} /> {editingId ? 'حفظ التعديل' : 'إضافة المنتج'}</button>
      </form>
      <div className="panel">
        <label className="searchBox wide"><Search size={18} /><input placeholder="بحث في المنتجات والمخزون..." value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="adminList">
          {filtered.map((product) => <article className="adminProduct" key={product.id}><img src={normalizeImageUrl(product.image) || FALLBACK_PRODUCT_IMAGE} alt={product.name} onError={imageFallback} /><div><h3>{product.name}</h3><p>{formatPrice(product.price)} درهم - المخزون: {Number(product.stock || 0)}</p></div><button className="iconBtn" onClick={() => editProduct(product)}><Edit3 /></button><button className="iconBtn danger" onClick={() => removeProduct(product.id)}><Trash2 /></button></article>)}
        </div>
      </div>
    </section>
  )
}

function OrdersAdmin({ orders }) {
  const [search, setSearch] = useState('')
  const filtered = orders.filter((order) => JSON.stringify(order).toLowerCase().includes(search.toLowerCase()))

  async function setStatus(order, status) {
    if (!firebaseReady) return Swal.fire('إعدادات ناقصة', 'إعدادات الطلبات غير مفعلة بعد.', 'info')
    if (status === 'cancelled' && !order.stockRestored) {
      const batch = writeBatch(db)
      batch.update(doc(db, 'orders', order.id), { status, stockRestored: true, updatedAt: serverTimestamp() })
      order.items.forEach((item) => batch.update(doc(db, 'products', item.id), { stock: increment(item.quantity) }))
      await batch.commit()
    } else {
      await updateDoc(doc(db, 'orders', order.id), { status, updatedAt: serverTimestamp() })
    }
    Swal.fire('تم التحديث', 'تم تغيير حالة الطلب بنجاح.', 'success')
  }

  return (
    <section className="panel">
      <label className="searchBox wide"><Search size={18} /><input placeholder="بحث في الطلبات بالاسم، الهاتف، المدينة أو الحالة..." value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <div className="ordersList">
        {!filtered.length && <div className="empty">لا توجد طلبات بعد.</div>}
        {filtered.map((order) => <article className="orderCard" key={order.id}><div className="orderTop"><div><h3>{order.customer?.fullName}</h3><p><Phone size={15} /> {order.customer?.phone}</p><p><CalendarDays size={15} /> {order.createdAtText || 'تاريخ غير متوفر'}</p></div><span className={`status ${order.status}`}>{statusLabel(order.status)}</span></div><p><Truck size={15} /> {order.customer?.city} - {order.customer?.address}</p><div className="miniItems">{order.items?.map((item) => <span key={item.id}>{item.name} x {item.quantity}</span>)}</div><strong>المجموع: {formatPrice(order.total)} درهم</strong><div className="orderActions"><a className="ghost" target="_blank" href={`https://wa.me/${String(order.customer?.phone || '').replace(/\D/g, '')}`}><MessageCircle size={17} /> واتساب</a><a className="ghost" href={`tel:${order.customer?.phone}`}><Phone size={17} /> اتصال</a><select value={order.status || 'new'} onChange={(e) => setStatus(order, e.target.value)}><option value="new">جديد</option><option value="confirmed">مؤكد</option><option value="delivered">تم التسليم</option><option value="cancelled">ملغى</option></select></div></article>)}
      </div>
    </section>
  )
}

function statusLabel(status) {
  return { new: 'جديد', confirmed: 'مؤكد', delivered: 'تم التسليم', cancelled: 'ملغى' }[status] || 'جديد'
}

function Footer({ openAdmin }) {
  return (
    <footer>
      <p>© {new Date().getFullYear()} Cosmetique <button className="adminWord" onClick={openAdmin}>Mouzouni</button>. جميع الحقوق محفوظة.</p>
    </footer>
  )
}
