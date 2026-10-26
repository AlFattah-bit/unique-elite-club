(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const money = (amount) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(amount || 0));
  const dateFmt = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  let supabase = null, currentUser = null, currentProfile = null;
  const configured = window.CLUB_CONFIG && /^https:\/\/.+/.test(window.CLUB_CONFIG.SUPABASE_URL) &&
    !window.CLUB_CONFIG.SUPABASE_URL.includes("_HERE") && window.CLUB_CONFIG.SUPABASE_ANON_KEY &&
    !window.CLUB_CONFIG.SUPABASE_ANON_KEY.includes("_HERE");

  function message(id, text, error=false) {
    const el = $(id); if (!el) return;
    el.textContent = text; el.classList.toggle("error", !!error);
  }
  function safeText(tag, text, className) {
    const el = document.createElement(tag); el.textContent = text ?? "";
    if (className) el.className = className;
    return el;
  }
  function cell(row, text, className) {
    const td = document.createElement("td");
    if (className) td.append(safeText("span", text, className)); else td.textContent = text ?? "";
    row.append(td); return td;
  }
  function emptyRow(tbodyId, colspan, text) {
    const body = $(tbodyId); if (!body) return;
    body.replaceChildren();
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = colspan; td.textContent = text; tr.append(td); body.append(tr);
  }
  async function dbError(result, userMessage) {
    if (result.error) { console.error(userMessage, result.error); throw new Error(userMessage + " " + result.error.message); }
    return result.data;
  }
  function officer() { return currentProfile && ["admin", "treasurer"].includes(currentProfile.role); }
  function admin() { return currentProfile && currentProfile.role === "admin"; }
  function setAuthTab(tab) {
    $("login-form").hidden = tab !== "login"; $("register-form").hidden = tab !== "register";
    $("show-login").classList.toggle("active", tab === "login");
    $("show-register").classList.toggle("active", tab === "register");
    message("auth-message", "");
  }
  function showPanel(panelId) {
    document.querySelectorAll(".dash-panel").forEach(p => p.hidden = p.id !== panelId);
    document.querySelectorAll(".dash-tab").forEach(b => b.classList.toggle("active", b.dataset.panel === panelId));
  }
  function setupUI() {
    $("year").textContent = new Date().getFullYear();
    $("menu-toggle").addEventListener("click", () => {
      const nav = $("main-nav"), open = nav.classList.toggle("open");
      $("menu-toggle").setAttribute("aria-expanded", String(open));
    });
    $("main-nav").querySelectorAll("a").forEach(a => a.addEventListener("click", () => $("main-nav").classList.remove("open")));
    $("show-login").addEventListener("click", () => setAuthTab("login"));
    $("show-register").addEventListener("click", () => setAuthTab("register"));
    document.querySelectorAll(".dash-tab").forEach(b => b.addEventListener("click", () => showPanel(b.dataset.panel)));
    $("login-form").addEventListener("submit", signIn);
    $("register-form").addEventListener("submit", register);
    $("sign-out").addEventListener("click", signOut);
    $("payment-form").addEventListener("submit", savePayment);
    $("announcement-form").addEventListener("submit", publishAnnouncement);
    $("attendance-form").addEventListener("submit", saveAttendance);
    $("savings-form").addEventListener("submit", saveSavings);
    $("approval-form").addEventListener("submit", approveMember);
  }
  async function init() {
    setupUI();
    if (!configured || !window.supabase) {
      message("auth-message", "Website preview is ready. Supabase has not been configured yet; follow README.txt to connect it.");
      return;
    }
    supabase = window.supabase.createClient(window.CLUB_CONFIG.SUPABASE_URL, window.CLUB_CONFIG.SUPABASE_ANON_KEY);
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.error(error);
    if (session) await loadSession(session.user);
    loadPublicAnnouncements();
    supabase.auth.onAuthStateChange((_event, sessionNow) => {
      if (sessionNow?.user) setTimeout(() => loadSession(sessionNow.user), 0);
      else clearSessionUI();
    });
  }
  async function signIn(e) {
    e.preventDefault();
    if (!supabase) return message("auth-message", "Supabase setup is not complete yet.", true);
    message("auth-message", "Signing in…");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
      if (error) throw error;
      await loadSession(data.user);
    } catch (err) { message("auth-message", err.message || "Could not sign in.", true); }
  }
  async function register(e) {
    e.preventDefault();
    if (!supabase) return message("auth-message", "Supabase setup is not complete yet.", true);
    const name = $("register-name").value.trim(), email = $("register-email").value.trim(), phone = $("register-phone").value.trim();
    message("auth-message", "Submitting registration…");
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password: $("register-password").value,
        options: { data: { full_name: name, phone } }
      });
      if (error) throw error;
      if (data.user && !data.session) {
        message("auth-message", "Registration submitted. Check your email if confirmation is required, then sign in after confirming. An officer must approve your membership.");
      } else if (data.user) {
        await loadSession(data.user);
        message("auth-message", "Registration submitted. Your membership is pending officer approval.");
      } else message("auth-message", "If the email is eligible, registration instructions will be sent.");
      $("register-form").reset();
    } catch (err) { message("auth-message", err.message || "Registration failed.", true); }
  }
  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    clearSessionUI(); setAuthTab("login"); message("auth-message", "You have signed out.");
  }
  function clearSessionUI() {
    currentUser = null; currentProfile = null;
    $("dashboard").hidden = true; $("auth-card").hidden = false;
  }
  async function loadSession(user) {
    currentUser = user;
    try {
      const result = await supabase.from("profiles").select("id, full_name, phone, membership_number, status, role").eq("id", user.id).single();
      if (result.error) throw result.error;
      currentProfile = result.data;
      $("auth-card").hidden = true; $("dashboard").hidden = false;
      $("welcome-title").textContent = `Welcome, ${currentProfile.full_name || user.email}`;
      $("member-status").textContent = `Membership: ${currentProfile.membership_number || "Pending number"} · Status: ${currentProfile.status}`;
      const approved = currentProfile.status === "approved";
      $("pending-notice").hidden = approved;
      $("member-content").hidden = !approved;
      document.querySelectorAll(".admin-only").forEach(el => el.hidden = !officer());
      if (approved) {
        await Promise.all([loadPayments(), loadAttendance(), loadSavings(), loadMemberAnnouncements()]);
        if (officer()) await loadOfficerOptions();
      }
    } catch (err) {
      console.error(err);
      message("auth-message", "Signed in, but the member profile could not be loaded. Check the database setup instructions.", true);
      $("auth-card").hidden = false;
    }
  }
  async function loadPayments() {
    const body = $("payments-table"); emptyRow("payments-table", 6, "Loading payment records…");
    try {
      const data = await dbError(await supabase.from("weekly_payments").select("id, week_start, member_id, amount_due, amount_paid, note, profiles:member_id(full_name, membership_number)").order("week_start", { ascending: false }), "Could not load payments.");
      body.replaceChildren();
      if (!data?.length) return emptyRow("payments-table", 6, "No weekly payment records have been entered yet.");
      data.forEach(p => {
        const tr = document.createElement("tr"), due = Number(p.amount_due), paid = Number(p.amount_paid), balance = Math.max(0, due-paid);
        cell(tr, dateFmt(p.week_start)); cell(tr, p.profiles?.full_name || "Member");
        cell(tr, money(due)); cell(tr, money(paid)); cell(tr, money(balance));
        const status = paid >= due ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
        cell(tr, status, `status ${status.toLowerCase()}`); body.append(tr);
      });
    } catch (err) { emptyRow("payments-table", 6, err.message); }
  }
  async function loadAttendance() {
    try {
      const data = await dbError(await supabase.from("attendance_records").select("meeting_date, member_id, status, penalty_amount, profiles:member_id(full_name)").order("meeting_date", { ascending: false }), "Could not load attendance.");
      const body = $("attendance-table"); body.replaceChildren();
      if (!data?.length) return emptyRow("attendance-table", 4, "No attendance records yet.");
      data.forEach(x => { const tr=document.createElement("tr"); cell(tr,dateFmt(x.meeting_date)); cell(tr,x.profiles?.full_name||"Member"); cell(tr,x.status); cell(tr,money(x.penalty_amount)); body.append(tr); });
    } catch (err) { emptyRow("attendance-table",4,err.message); }
  }
  async function loadSavings() {
    try {
      const data = await dbError(await supabase.from("financial_records").select("record_date, member_id, record_type, amount, note, profiles:member_id(full_name)").order("record_date", { ascending: false }), "Could not load financial records.");
      const body=$("savings-table"); body.replaceChildren();
      if (!data?.length) return emptyRow("savings-table",5,"No savings or investment records yet.");
      data.forEach(x=>{const tr=document.createElement("tr");cell(tr,dateFmt(x.record_date));cell(tr,x.profiles?.full_name||"Member");cell(tr,x.record_type);cell(tr,money(x.amount));cell(tr,x.note||"—");body.append(tr);});
    } catch(err){emptyRow("savings-table",5,err.message);}
  }
  function addAnnouncement(container, item) {
    const article=document.createElement("article"); article.className="announcement";
    article.append(safeText("h3",item.title||"Club announcement"));
    article.append(safeText("p",item.body||""));
    article.append(safeText("p",dateFmt(item.created_at?.slice(0,10)),"date"));
    if(item.image_url){const img=document.createElement("img");img.src=item.image_url;img.alt="Club announcement image";img.loading="lazy";img.referrerPolicy="no-referrer";article.append(img);}
    container.append(article);
  }
  async function loadPublicAnnouncements() {
    if (!supabase) return;
    try {
      const {data,error}=await supabase.from("announcements").select("id,title,body,image_url,created_at").eq("is_published",true).order("created_at",{ascending:false}).limit(8);
      if(error) throw error;
      const box=$("public-announcements");box.replaceChildren();
      if(!data?.length){box.append(safeText("p","No announcements have been published yet.","empty-state"));return;}
      data.forEach(item=>addAnnouncement(box,item));
    } catch(err){console.warn("Public announcements unavailable",err);}
  }
  async function loadMemberAnnouncements() {
    try {
      const {data,error}=await supabase.from("announcements").select("id,title,body,image_url,created_at").eq("is_published",true).order("created_at",{ascending:false}).limit(50);
      if(error)throw error;
      const box=$("member-announcements");box.replaceChildren();
      if(!data?.length)box.append(safeText("p","No announcements yet.","empty-state"));
      else data.forEach(item=>addAnnouncement(box,item));
      const photos=$("photo-gallery");photos.replaceChildren();
      (data||[]).filter(x=>x.image_url).forEach(x=>{const img=document.createElement("img");img.src=x.image_url;img.alt=x.title||"Club photo";img.loading="lazy";photos.append(img);});
    } catch(err){$("member-announcements").textContent=err.message;}
  }
  async function loadOfficerOptions() {
    try {
      const {data,error}=await supabase.from("profiles").select("id,full_name,membership_number,status").eq("status","approved").order("full_name");
      if(error)throw error;
      ["payment-member","attendance-member","savings-member"].forEach(id=>{
        const select=$(id);select.replaceChildren(new Option("Choose a member",""));
        (data||[]).forEach(p=>select.add(new Option(`${p.full_name} (${p.membership_number||"No number"})`,p.id)));
      });
      const {data:pending,error:pendingErr}=await supabase.from("profiles").select("id,full_name").eq("status","pending").order("full_name");
      if(pendingErr)throw pendingErr;
      const select=$("pending-member");select.replaceChildren(new Option("Choose pending member",""));
      (pending||[]).forEach(p=>select.add(new Option(p.full_name,p.id)));
    } catch(err){message("admin-message","Could not load officer lists. Check permissions: "+err.message,true);}
  }
  async function savePayment(e) {
    e.preventDefault(); if(!officer())return message("admin-message","Not authorized.",true);
    try {
      const payload={member_id:$("payment-member").value,week_start:$("payment-week").value,amount_due:Number($("payment-due").value),amount_paid:Number($("payment-paid").value),note:$("payment-note").value.trim(),entered_by:currentUser.id};
      if(payload.amount_due<0||payload.amount_paid<0)throw new Error("Amounts cannot be negative.");
      await dbError(await supabase.from("weekly_payments").upsert(payload,{onConflict:"member_id,week_start"}),"Could not save payment.");
      message("admin-message","Payment record saved.");$("payment-form").reset();await loadPayments();
    } catch(err){message("admin-message",err.message,true);}
  }
  async function uploadAnnouncementImage(file) {
    if(!file)return null;
    if(!file.type.startsWith("image/"))throw new Error("Please choose an image file.");
    if(file.size>5*1024*1024)throw new Error("Please choose an image smaller than 5 MB.");
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
    const path=`announcements/${currentUser.id}/${Date.now()}.${ext}`;
    const {error}=await supabase.storage.from(window.CLUB_CONFIG.STORAGE_BUCKET).upload(path,file,{upsert:false,contentType:file.type});
    if(error)throw error;
    const {data}=supabase.storage.from(window.CLUB_CONFIG.STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }
  async function publishAnnouncement(e) {
    e.preventDefault(); if(!officer())return message("admin-message","Not authorized.",true);
    try {
      const file=$("announcement-image").files[0], image_url=await uploadAnnouncementImage(file);
      await dbError(await supabase.from("announcements").insert({title:$("announcement-title").value.trim(),body:$("announcement-body").value.trim(),image_url,is_published:true,created_by:currentUser.id}),"Could not publish announcement.");
      message("admin-message","Announcement published.");$("announcement-form").reset();await Promise.all([loadPublicAnnouncements(),loadMemberAnnouncements()]);
    } catch(err){message("admin-message",err.message,true);}
  }
  async function saveAttendance(e) {
    e.preventDefault();if(!officer())return message("admin-message","Not authorized.",true);
    try{
      const payload={member_id:$("attendance-member").value,meeting_date:$("attendance-date").value,status:$("attendance-status").value,penalty_amount:Number($("attendance-penalty").value),recorded_by:currentUser.id};
      if(payload.penalty_amount<0)throw new Error("Penalty cannot be negative.");
      await dbError(await supabase.from("attendance_records").upsert(payload,{onConflict:"member_id,meeting_date"}),"Could not save attendance.");
      message("admin-message","Attendance saved.");$("attendance-form").reset();await loadAttendance();
    }catch(err){message("admin-message",err.message,true);}
  }
  async function saveSavings(e) {
    e.preventDefault();if(!officer())return message("admin-message","Not authorized.",true);
    try{
      const payload={member_id:$("savings-member").value,record_date:$("savings-date").value,record_type:$("savings-type").value,amount:Number($("savings-amount").value),note:$("savings-note").value.trim(),recorded_by:currentUser.id};
      if(payload.amount<0)throw new Error("Amount cannot be negative.");
      await dbError(await supabase.from("financial_records").insert(payload),"Could not save financial record.");
      message("admin-message","Financial record saved.");$("savings-form").reset();await loadSavings();
    }catch(err){message("admin-message",err.message,true);}
  }
  async function approveMember(e) {
    e.preventDefault();if(!admin())return message("admin-message","Only an administrator can approve members.",true);
    try{
      const id=$("pending-member").value;
      await dbError(await supabase.rpc("approve_club_member",{target_user_id:id}),"Could not approve member.");
      message("admin-message","Member approved.");await loadOfficerOptions();
    }catch(err){message("admin-message",err.message,true);}
  }
  document.addEventListener("DOMContentLoaded", init);
})();