/* ============================================================
   custom-select.js
   自定义下拉菜单（深色主题，不依赖原生 select 渲染）
   用法：在 HTML 中按以下结构书写，脚本会自动初始化所有实例
   <div class="custom-select-wrapper" id="xxxWrapper">
     <select id="xxx" class="holiday-type-select" style="display:none">
       <option value="a">A</option>...
     </select>
     <div class="custom-select-trigger" id="xxxTrigger">
       <span class="custom-select-value" id="xxxDisplay">A</span>
       <span class="custom-select-arrow">▾</span>
     </div>
     <div class="custom-select-dropdown" id="xxxDropdown">
       <div class="custom-option" data-value="a">A</div>...
     </div>
   </div>
   ============================================================ */
(function () {
  "use strict";

  // ---------- 工具：关闭页面上所有打开的下拉 ----------
  function closeAllDropdowns() {
    document.querySelectorAll(".custom-select-dropdown.open").forEach(function (d) {
      d.classList.remove("open");
    });
    document.querySelectorAll(".custom-select-trigger.open").forEach(function (t) {
      t.classList.remove("open");
    });
  }

  // ---------- 初始化单个下拉实例 ----------
  function initOne(wrapper) {
    const trigger  = wrapper.querySelector(".custom-select-trigger");
    const dropdown = wrapper.querySelector(".custom-select-dropdown");
    const display  = wrapper.querySelector(".custom-select-value");
    const native   = wrapper.querySelector("select");
    if (!trigger || !dropdown) return; // 结构不完整则跳过

    const options  = dropdown.querySelectorAll(".custom-option");

    // 点击触发器：开关当前下拉
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains("open");
      closeAllDropdowns();
      if (!isOpen) {
        dropdown.classList.add("open");
        trigger.classList.add("open");
      }
    });

    // 点击选项
    options.forEach(function (opt) {
      opt.addEventListener("click", function () {
        const value = opt.dataset.value;
        const text  = opt.textContent.trim();

        // 同步显示
        if (display) display.textContent = text;

        // 同步隐藏的原生 select（保持表单值可用）
        if (native) {
          native.value = value;
          native.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // 选中态高亮
        options.forEach(function (o) { o.classList.remove("selected"); });
        opt.classList.add("selected");

        closeAllDropdowns();
      });
    });

    // 初始化：根据原生 select 的当前值，同步显示与选中态
    function syncFromNative() {
      if (!native) return;
      const cur = native.value;
      options.forEach(function (o) {
        if (o.dataset.value === cur) {
          o.classList.add("selected");
          if (display) display.textContent = o.textContent.trim();
        } else {
          o.classList.remove("selected");
        }
      });
    }
    syncFromNative();

    // 若外部代码改了原生 select 的 value，自动同步
    if (native) {
      native.addEventListener("change", syncFromNative);
    }
  }

  // ---------- 启动：初始化所有下拉 ----------
  function initAll() {
    document.querySelectorAll(".custom-select-wrapper").forEach(initOne);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  // 点击页面空白处关闭所有下拉
  document.addEventListener("click", closeAllDropdowns);

  // 暴露给外部：可在动态添加下拉后手动调用
  window.CustomSelect = { init: initAll, closeAll: closeAllDropdowns };
})();
