/* =====================================================================
   Sunset Dentistry: shared script for all pages. Load with <script defer>
   after the GSAP, ScrollTrigger and Lenis scripts (also deferred), so the
   libraries run first and this runs before DOMContentLoaded.

   Everything is declarative and opt-in through markup; nothing here
   assumes a particular page:
     data-layer                     marks a stacked layer (wrapper)
     data-pin="top|bottom|none"     pin edge (a hint for the CSS fallback;
                                    JS picks top/bottom by measured height)
     data-depth                     covered-layer depth effect
     data-depth-tint="<selector>"   reuse an existing overlay in the layer
     data-parallax="0.12"           inner photo parallax strength
     .side-nav button[data-target]  side-nav dots for section ids
   Page features (accordion, team filter, time picker, testimonial
   carousel, form intercept) each no-op when their elements are absent.
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // Mobile nav toggle
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  toggle?.addEventListener("click", () => {
    links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", links.classList.contains("is-open"));
  });

  // ================= scroll engine =================
  // Enhanced path: GSAP + ScrollTrigger loaded (Lenis optional).
  // Fallback path: a library is missing, so the CSS sticky stack
  // stays in charge and IntersectionObserver / a scroll listener
  // drive reveals, the side nav and the header.
  // The helpers below are shared by both paths.
  const root = document.documentElement;
  // Must match the CSS pinning media query (see "layered stack").
  const PIN_QUERY =
    "(min-width: 901px) and (min-height: 600px) and (max-aspect-ratio: 12/5) and (prefers-reduced-motion: no-preference)";
  const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
  const pinMq = window.matchMedia(PIN_QUERY);
  const header = document.getElementById("siteHeader");
  const sideButtons = Array.from(document.querySelectorAll(".side-nav button"));
  const navButtons = sideButtons.filter((b) =>
    document.getElementById(b.dataset.target),
  );
  const navTargets = navButtons.map((b) =>
    document.getElementById(b.dataset.target),
  );
  // data-through="<id>" lets one dot span several sections: its range
  // runs from its target's top to the bottom of that later element.
  const navEnds = navButtons.map(
    (b, i) =>
      (b.dataset.through && document.getElementById(b.dataset.through)) ||
      navTargets[i],
  );
  const revealEls = document.querySelectorAll(".reveal, .reveal-stagger");
  const layers = Array.from(document.querySelectorAll("[data-layer]"));
  const hasGsap = !!(window.gsap && window.ScrollTrigger);
  let lenis = null; // set while Lenis is running
  // Section snap state (see snapWheel)
  const SNAP_GAP = 200; // ms without wheel events that ends a gesture
  const SNAP_MAX_HOLD = 1500; // ms: never hold one gesture longer
  let stackTriggers = []; // pin triggers, in document order
  let snapHold = null; // { dir, since, last } while held at a stop

  const viewportH = () => root.clientHeight;

  // Side-nav clicks and in-page anchors land a section this far below
  // the viewport top, clear of the fixed header (~87-103px tall). The
  // active dot tracks the section under the same line, so a section you
  // jump to is always the one highlighted, however short it is.
  const NAV_OFFSET = 100;

  // An element's position in normal document flow, as a scroll
  // offset. While a layer is pinned it's drawn somewhere other than
  // its flow position, so getBoundingClientRect / scrollIntoView
  // would aim at the stuck copy. Instead, use the static .layer
  // wrapper's position plus the element's offsetTop inside
  // .layer-body (its offsetParent). offsetTop ignores transforms,
  // so a scaled, covered layer doesn't skew the result. Works the
  // same under CSS sticky, ScrollTrigger pins and no pinning.
  function flowTop(el) {
    const layer = el.closest("[data-layer]");
    if (!layer) return el.getBoundingClientRect().top + window.scrollY;
    const body = layer.querySelector(".layer-body");
    let y = 0;
    for (let n = el; n && n !== body; n = n.offsetParent) {
      y += n.offsetTop;
    }
    return layer.getBoundingClientRect().top + window.scrollY + y;
  }

  // Every programmatic scroll goes through Lenis when it's running,
  // so Lenis and ScrollTrigger stay in step. Without Lenis, a native
  // scroll: smooth unless the user prefers reduced motion.
  const motionMq = window.matchMedia(MOTION_QUERY);
  function scrollToY(y, { immediate = false } = {}) {
    const top = Math.max(0, Math.round(y));
    if (lenis) lenis.scrollTo(top, { immediate, force: true });
    else
      window.scrollTo({
        top,
        behavior: immediate || !motionMq.matches ? "instant" : "smooth",
      });
  }

  function setActiveNav(id) {
    sideButtons.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.target === id),
    );
  }

  // Side-nav clicks: go to the section's flow position.
  sideButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) scrollToY(flowTop(target) - NAV_OFFSET);
    });
  });

  // In-page anchor links (#id on this page) take the same route.
  // Focus moves to the target without a second jump, for keyboard
  // and screen-reader users.
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href*="#"]');
    if (
      !a ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    const url = new URL(a.href, location.href);
    if (
      url.origin !== location.origin ||
      url.pathname !== location.pathname ||
      !url.hash
    )
      return;
    const target = document.getElementById(
      decodeURIComponent(url.hash.slice(1)),
    );
    if (!target) return;
    e.preventDefault();
    history.pushState(null, "", url.hash);
    scrollToY(flowTop(target) - NAV_OFFSET);
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });

  // Keep keyboard focus visible inside the layered stack.
  // A pinned layer is geometrically "in view" while a later layer
  // covers it, so the browser's own focus-scrolling won't move it
  // (e.g. Shift+Tab from services back to the hero buttons). If the
  // focused element is covered by a later layer, jump to where it
  // sits in flow. Skipped for tabindex="-1" targets, which the
  // anchor handler above is already scrolling to.
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    const layer = el.closest?.("[data-layer]");
    if (!pinMq.matches || !layer || el.getAttribute("tabindex") === "-1")
      return;
    // wait a frame so any native focus scroll has already happened
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      const hitLayer = hit?.closest("[data-layer]");
      const coveredByLater =
        hitLayer &&
        hitLayer !== layer &&
        layer.compareDocumentPosition(hitLayer) &
          Node.DOCUMENT_POSITION_FOLLOWING;
      if (!coveredByLater) return;
      // Put the element ~120px below the header, but never past the
      // point where its layer starts pinning (top pin: the layer's
      // top; bottom pin: its bottom at the viewport bottom), where
      // it would be covered again.
      const pin = layer.querySelector(".layer-pin");
      const layerTop = layer.getBoundingClientRect().top + window.scrollY;
      const offset = flowTop(el) - layerTop;
      const pinStart = Math.max(0, pin.offsetHeight - viewportH());
      scrollToY(layerTop + Math.min(offset - 120, pinStart), {
        immediate: true,
      });
    });
  });

  // Safety net: guarantee nothing stays permanently hidden if a
  // reveal trigger never fires (deep-link jumps, very fast scroll,
  // odd browser timing). Applies to both paths.
  setTimeout(() => {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }, 2500);

  // Count-up stats
  const counters = document.querySelectorAll(".stat-count[data-count]");
  const countObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.count, 10);
        const suffix = el.dataset.suffix || "";
        if (isNaN(target) || target <= 1) {
          countObserver.unobserve(el);
          return;
        }
        // data-count-delay (ms): hold the count until an intro
        // animation has brought the number into view
        const delay = parseInt(el.dataset.countDelay, 10) || 0;
        const start = performance.now() + delay;
        const dur = 1400;
        function tick(now) {
          const p = Math.min(Math.max(now - start, 0) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(eased * target) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        countObserver.unobserve(el);
      });
    },
    { threshold: 0.6 },
  );
  counters.forEach((el) => countObserver.observe(el));

  // Safety net: if a counter's observer never fires, still land on the right number.
  setTimeout(() => {
    counters.forEach((el) => {
      const target = parseInt(el.dataset.count, 10);
      if (!isNaN(target) && target > 1 && el.textContent.trim() === "0") {
        el.textContent = target + (el.dataset.suffix || "");
      }
    });
  }, 3000);

  if (hasGsap) initEnhanced();
  else initFallback();

  // ---------- enhanced: GSAP + ScrollTrigger (+ Lenis) ----------
  function initEnhanced() {
    // Before anything touches ScrollTrigger (see html.st-ready CSS).
    root.classList.add("st-ready");
    gsap.registerPlugin(ScrollTrigger);
    // Mobile URL-bar show/hide resizes the viewport height only;
    // don't recalculate every trigger for it.
    ScrollTrigger.config({ ignoreMobileResize: true });
    // Standard Lenis sync: never let GSAP "catch up" after a stall,
    // or scrubbed layers would jump.
    gsap.ticker.lagSmoothing(0);

    // Header state, from one trigger spanning the whole page.
    const paintChrome = (self) => {
      header.classList.toggle("is-scrolled", self.scroll() > 40);
    };
    ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: paintChrome,
      onRefresh: paintChrome,
    });

    // Side-nav active dot. Each target owns the stretch of scroll where
    // the line NAV_OFFSET below the viewport top is over its flow
    // position (a few px of slack absorb scroll rounding). Flow ranges
    // work even with pinning, because the layer that is moving (the
    // incoming one) is never pinned while it covers, so its visible
    // edge equals its flow edge. Ranges come from flowTop (not
    // trigger:), so depth transforms can't skew them. The last target
    // is stretched to the end of the page so it still activates if it
    // never reaches the line (a footer shorter than the viewport).
    // A data-through dot ends at the bottom of its through element.
    const navLine = NAV_OFFSET + 8;
    const lastIdx = navTargets.length - 1;
    // Filled in as they're created: onRefresh fires during create().
    const navTriggers = [];
    navTargets.forEach((el, i) =>
      navTriggers.push(
        ScrollTrigger.create({
          start: () => {
            const s = Math.max(0, flowTop(el) - navLine);
            return i === lastIdx
              ? Math.min(s, ScrollTrigger.maxScroll(window) - 1)
              : s;
          },
          end: () =>
            i === lastIdx
              ? ScrollTrigger.maxScroll(window) + 1
              : flowTop(navEnds[i]) + navEnds[i].offsetHeight - navLine,
          onToggle: syncNav,
          onRefresh: syncNav,
        }),
      ),
    );
    // When ranges touch or overlap, the last active one wins.
    function syncNav() {
      for (let i = navTriggers.length - 1; i >= 0; i--) {
        if (navTriggers[i]?.isActive) {
          setActiveNav(navTargets[i].id);
          return;
        }
      }
    }

    // Reveals: class toggle only, so the CSS transition owns the
    // animation and GSAP never writes transforms to these elements
    // (and they're never the pinned or depth-scaled elements).
    ScrollTrigger.batch(revealEls, {
      start: "top 92%",
      once: true,
      onEnter: (batch) => batch.forEach((el) => el.classList.add("is-visible")),
    });

    // Three motion configs. gsap.matchMedia reverts everything
    // created inside when the conditions change (resize, OS
    // reduced-motion toggle):
    //   full    = PIN_QUERY: Lenis + ScrollTrigger pinning + depth
    //   reduced = motion OK but not full (tablet/mobile, short or
    //             ultra-wide windows): Lenis only, no pins or depth
    //   off     = prefers-reduced-motion: plain native scrolling
    // Header, side nav and reveals (above) run in all
    // three; under reduced motion CSS shows reveals immediately.
    // Inner photo parallax is an extra on top of "full", only for a
    // mouse/trackpad (not touch-first devices, even at desktop size).
    const mm = gsap.matchMedia();
    mm.add(
      {
        full: PIN_QUERY,
        motion: MOTION_QUERY,
        finePointer: "(hover: hover) and (pointer: fine)",
      },
      (ctx) => {
        const { full, motion, finePointer } = ctx.conditions;
        const stopLenis = motion ? startLenis() : null;
        const stopStack = full ? buildStack() : null;
        if (full && finePointer) buildParallax();
        requestAnimationFrame(() => ScrollTrigger.refresh());
        return () => {
          stopStack?.();
          stopLenis?.();
        };
      },
    );

    // Layer heights can change without a resize (an accordion opening,
    // the team filter hiding cards). Pin ranges depend on those heights,
    // so re-measure once the size settles. Debounced: the accordion
    // animates its height over ~0.35s.
    if ("ResizeObserver" in window) {
      let roTimer;
      const heights = new WeakMap();
      const ro = new ResizeObserver((entries) => {
        // ignore the first observation and width-only changes (window
        // resizes are already handled by ScrollTrigger itself)
        let changed = false;
        entries.forEach((en) => {
          const h = Math.round(en.contentRect.height);
          const prev = heights.get(en.target);
          heights.set(en.target, h);
          if (prev !== undefined && prev !== h) changed = true;
        });
        if (!changed) return;
        clearTimeout(roTimer);
        roTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
      });
      layers.forEach((l) => {
        const body = l.querySelector(".layer-body");
        if (body) ro.observe(body);
      });
    }

    // Measure again once fonts and images have settled (text
    // reflow changes layer heights and therefore pin ranges).
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    window.addEventListener("load", () => {
      ScrollTrigger.refresh();
      // Deep links: the browser's initial jump targeted the CSS
      // layout, so re-aim at the flow position.
      const target =
        location.hash &&
        document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) scrollToY(flowTop(target) - NAV_OFFSET, { immediate: true });
    });
    let refreshTimer;
    document.querySelectorAll("img").forEach((img) => {
      if (img.complete) return;
      img.addEventListener(
        "load",
        () => {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 150);
        },
        { once: true },
      );
    });
  }

  // Section snap: before a layer starts to be covered, wheel scrolling
  // stops at that layer's pin start (its bottom edge on the viewport
  // bottom, or its top on the viewport top for one that fits) and holds
  // there until the gesture ends, trackpad inertia included. The next
  // gesture carries on into the layered effect. Works both ways, so
  // scrolling back up also stops with the layer fully uncovered.
  // Lenis wheel input only, and only while the stack is built
  // (stackTriggers is empty otherwise). Keyboard, scrollbar, touch and
  // programmatic scrolls (side nav, anchors) pass straight through.
  function snapWheel({ deltaY, event }) {
    if (
      !lenis ||
      !stackTriggers.length ||
      !event.type.includes("wheel") ||
      event.ctrlKey || // pinch zoom
      !deltaY ||
      event.target.closest?.(
        "[data-lenis-prevent], [data-lenis-prevent-wheel], [data-lenis-prevent-vertical]",
      )
    )
      return true;
    const now = performance.now();
    const dir = Math.sign(deltaY);
    const swallow = () => {
      if (event.cancelable) event.preventDefault();
      return false;
    };

    if (snapHold) {
      const ended =
        dir !== snapHold.dir ||
        now - snapHold.last > SNAP_GAP ||
        now - snapHold.since > SNAP_MAX_HOLD;
      if (!ended) {
        snapHold.last = now;
        return swallow();
      }
      snapHold = null;
    }

    // Would this step cross a pin start? Nearest one in the direction
    // of travel wins. ScrollTrigger keeps st.start current on refresh.
    const from = lenis.targetScroll;
    const to = from + deltaY;
    const max = ScrollTrigger.maxScroll(window);
    let stop = null;
    for (const st of stackTriggers) {
      const s = st.start;
      if (s <= 1 || s >= max - 1) continue; // page top/end: nothing to stop
      if (dir > 0 && from < s - 1 && to >= s - 1) {
        stop = s;
        break;
      }
      if (dir < 0 && from > s + 1 && to <= s + 1) stop = s;
    }
    if (stop === null) return true;

    lenis.scrollTo(stop, { programmatic: false, lerp: lenis.options.lerp });
    snapHold = { dir, since: now, last: now };
    return swallow();
  }

  // Lenis smooths wheel/trackpad input only. Touch stays native
  // (syncTouch left at its default, false). Standard ScrollTrigger
  // sync: Lenis reports every scroll to ScrollTrigger, and GSAP's
  // ticker drives Lenis's raf, so both update in the same frame.
  function startLenis() {
    if (!window.Lenis) return null; // Lenis failed to load: native scroll
    lenis = new Lenis({ autoRaf: false, virtualScroll: snapWheel });
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    return () => {
      gsap.ticker.remove(raf);
      // Lenis 1.3.26's destroy() leaves its 400ms velocity-reset
      // timer running; when it fires it re-adds the "lenis" classes
      // to <html>. Clear it (private field, pinned version).
      clearTimeout(lenis._resetVelocityTimeout);
      lenis.destroy();
      lenis = null;
    };
  }

  // ScrollTrigger version of the layered stack. html.st-stack turns
  // off the CSS sticky/spacer fallback first, so layers sit in plain
  // flow and ScrollTrigger measures that flow.
  function buildStack() {
    root.classList.add("st-stack");
    const shades = [];

    layers.forEach((layer) => {
      if (layer.dataset.pin !== "top" && layer.dataset.pin !== "bottom") return;
      const pin = layer.querySelector(".layer-pin");
      const body = layer.querySelector(".layer-body");
      const h = () => pin.offsetHeight;
      // JS can measure, so the pin edge follows the layer's real
      // height and data-pin is only a hint for the CSS fallback:
      //   fits the viewport   -> pin at "top top"
      //   taller than it      -> pin at "bottom bottom" (read it
      //                          all before it's covered)
      const tall = () => h() > viewportH();

      let overlay = null;
      let overlayTo = 0.5;
      if (layer.hasAttribute("data-depth")) {
        const tintSel = layer.dataset.depthTint;
        overlay = tintSel ? body.querySelector(tintSel) : null;
        if (overlay) {
          overlayTo = 0.8; // the hero tint deepens from its 0.5 rest
        } else {
          overlay = document.createElement("div");
          overlay.className = "layer-shade";
          overlay.setAttribute("aria-hidden", "true");
          body.appendChild(overlay);
          shades.push(overlay);
        }
      }

      // Pin range in px, from flow positions. The pin starts when the
      // layer's top reaches the viewport top (fits) or its bottom reaches
      // the viewport bottom (tall). It holds until the next layer has
      // fully covered it: min(height, viewport) of scroll later. (The
      // next layer starts where this one ends in flow and isn't pinned
      // while it moves, so it reaches the viewport top exactly then.)
      // The end is clamped to the page end, so a layer near the bottom
      // (a CTA or FAQ under a short footer) finishes its depth effect
      // when scrolling does. Both values come from this one function:
      // reading self.start inside end() returns the *previous* refresh's
      // start, which goes stale when a layer's height changes.
      const range = () => {
        const top = layer.getBoundingClientRect().top + window.scrollY;
        const start = tall() ? top + h() - viewportH() : top;
        const end = Math.min(
          start + Math.min(h(), viewportH()),
          ScrollTrigger.maxScroll(window),
        );
        return { start, end: Math.max(start + 1, end) };
      };

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: layer, // static wrapper: always its flow position
          start: () => range().start,
          end: () => range().end,
          pin, // the pin box, never the element that gets scaled
          pinSpacing: false, // overlap: don't push later layers down
          scrub: true, // Lenis already smooths; no second lag
          invalidateOnRefresh: true,
          // will-change only while this layer is animating
          onToggle: (self) => {
            body.style.willChange = self.isActive ? "transform" : "";
            if (overlay)
              overlay.style.willChange = self.isActive ? "opacity" : "";
          },
        },
      });
      stackTriggers.push(tl.scrollTrigger);

      if (overlay) {
        // Depth response of the covered layer: shrink to 0.95,
        // drift up a little, darken. Origin is the middle of the
        // part still on screen (the bottom viewport of a tall
        // layer), so it recedes in place instead of sliding.
        tl.to(
          body,
          {
            scale: 0.95,
            y: () => -Math.round(viewportH() * 0.04),
            transformOrigin: () =>
              `50% ${Math.max(h() / 2, h() - viewportH() / 2)}px`,
          },
          0,
        ).to(overlay, { opacity: overlayTo }, 0);
      }
    });

    return () => {
      stackTriggers = [];
      snapHold = null;
      shades.forEach((s) => s.remove());
      layers.forEach((l) => {
        const b = l.querySelector(".layer-body");
        if (b) b.style.willChange = "";
      });
      root.classList.remove("st-stack");
    };
  }

  // Inner photo parallax for [data-parallax] containers: the child
  // <picture> drifts inside the clipping container, scrubbed. Runs
  // inside the matchMedia context, so reverting it clears the
  // transforms and the photo returns to its static framing.
  function buildParallax() {
    document.querySelectorAll("[data-parallax]").forEach((box) => {
      const target = box.querySelector(":scope > picture");
      const strength = parseFloat(box.dataset.parallax);
      if (!target || !(strength > 0)) return;
      // Travel is strength x container height, centred on 0. The
      // picture is scaled by the same strength, so it overhangs the
      // container by strength/2 at the top and bottom: exactly the
      // largest offset, so no edge is ever exposed.
      // clientHeight: the inner box the picture fills (a bordered frame,
      // like the building photo, would otherwise over-travel by the
      // border width).
      const half = () => (strength / 2) * box.clientHeight;
      // Scale covers the travel, plus 1px spare at each edge so the
      // whole-pixel clientHeight can never leave a sub-pixel sliver.
      const cover = () => 1 + strength + 2 / Math.max(1, box.clientHeight);
      gsap.fromTo(
        target,
        { y: () => -half(), scale: cover },
        {
          y: () => half(),
          scale: cover,
          ease: "none",
          scrollTrigger: {
            // Flow-based range: from the container's top entering
            // the viewport bottom to its bottom leaving the top. For
            // a pinned layer this keeps running while the layer is
            // held (the hero drifts as the next layer covers it).
            // The hero starts at the top of the page, so at load it
            // is exactly mid-travel (y = 0, only the 1 + strength
            // zoom). flowTop keeps pinning and depth transforms out
            // of the measurement.
            start: () => flowTop(box) - viewportH(),
            end: () => flowTop(box) + box.offsetHeight,
            scrub: true,
            invalidateOnRefresh: true,
            onToggle: (self) => {
              target.style.willChange = self.isActive ? "transform" : "";
            },
          },
        },
      );
    });

    // Decoration planes ([data-drift]) around a framed photo: each
    // moves strength x frame height over the same flow-based range,
    // centred on its resting offset (negative runs the other way).
    // Unlike the picture nothing clips them; the frame's margin and
    // the small strengths keep them close to the photo.
    document.querySelectorAll("[data-drift]").forEach((deco) => {
      const frame = deco.parentElement;
      const strength = parseFloat(deco.dataset.drift);
      if (!frame || !strength) return;
      const half = () => (strength / 2) * frame.offsetHeight;
      gsap.fromTo(
        deco,
        { y: () => -half() },
        {
          y: () => half(),
          ease: "none",
          scrollTrigger: {
            start: () => flowTop(frame) - viewportH(),
            end: () => flowTop(frame) + frame.offsetHeight,
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });

    // Service photos warm from greyscale into colour as they rise to
    // the middle of the screen (the CSS reads --svc-color).
    document.querySelectorAll(".svc-photo").forEach((photo) => {
      gsap.fromTo(
        photo,
        { "--svc-color": 0 },
        {
          "--svc-color": 1,
          ease: "none",
          scrollTrigger: {
            start: () => flowTop(photo) - viewportH(),
            end: () => flowTop(photo) - viewportH() * 0.35,
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });
  }

  // ---------- fallback: libraries unavailable ----------
  function initFallback() {
    // Reveal-on-scroll
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    revealEls.forEach((el) => revealObserver.observe(el));

    // Side nav active section
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveNav(navIdFor.get(entry.target));
        });
      },
      { threshold: 0.5 },
    );
    // a data-through element lights its spanning dot
    const navIdFor = new Map();
    navTargets.forEach((s, i) => {
      navIdFor.set(s, s.id);
      navIdFor.set(navEnds[i], s.id);
    });
    navIdFor.forEach((_, el) => sectionObserver.observe(el));

    // Header scroll state (rAF-throttled)
    let ticking = false;
    function onScroll() {
      header.classList.toggle("is-scrolled", window.scrollY > 40);
      ticking = false;
    }
    window.addEventListener("scroll", () => {
      if (!ticking) {
        requestAnimationFrame(onScroll);
        ticking = true;
      }
    });
    onScroll();
  }

  // Accordion (services page)
  document.querySelectorAll(".accordion-trig").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".accordion-item");
      const panel = item.querySelector(".accordion-panel");
      const wasOpen = item.classList.contains("is-open");
      const group = item.closest(".accordion-group");
      if (group) {
        group.querySelectorAll(".accordion-item.is-open").forEach((open) => {
          open.classList.remove("is-open");
          open.querySelector(".accordion-panel").style.maxHeight = null;
        });
      }
      if (!wasOpen) {
        item.classList.add("is-open");
        panel.style.maxHeight = panel.scrollHeight + 40 + "px";
      }
    });
  });
  // Pre-open accordion items marked is-open in markup
  document
    .querySelectorAll(".accordion-item.is-open .accordion-panel")
    .forEach((panel) => {
      panel.style.maxHeight = panel.scrollHeight + 40 + "px";
    });

  // Team filter chips (about page)
  const chips = document.querySelectorAll(".filter-chip");
  const teamCards = document.querySelectorAll("[data-role]");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      const filter = chip.dataset.filter;
      teamCards.forEach((card) => {
        card.style.display =
          filter === "all" || card.dataset.role === filter ? "" : "none";
      });
      keepLayerUncovered(chip);
    });
  });
  // Filtering shrinks the team's layer, but the scroll position stays
  // put, so it can land past the point where the layer pins and the
  // next layer (FAQ) slides over the grid. Re-measure pins now (not
  // after the debounced ResizeObserver refresh), then pull back to
  // the layer's pin start if we're beyond it.
  function keepLayerUncovered(el) {
    const layer = el.closest("[data-layer]");
    if (!layer) return;
    if (hasGsap) ScrollTrigger.refresh();
    const pin = layer.querySelector(".layer-pin");
    const layerTop = layer.getBoundingClientRect().top + window.scrollY;
    const pinStart = layerTop + Math.max(0, pin.offsetHeight - viewportH());
    if (window.scrollY > pinStart) scrollToY(pinStart, { immediate: true });
  }

  // Appointment time-slot picker (schedule page)
  document.querySelectorAll(".time-opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      document
        .querySelectorAll(".time-opt")
        .forEach((o) => o.classList.remove("is-selected"));
      opt.classList.add("is-selected");
    });
  });

  // Testimonial carousel (services page)
  const track = document.querySelector(".quote-track");
  if (track) {
    const slides = track.querySelectorAll(".quote-slide");
    let i = 0;
    const show = (n) => {
      slides.forEach(
        (s, idx) => (s.style.display = idx === n ? "block" : "none"),
      );
    };
    show(0);
    document.querySelector(".quote-next")?.addEventListener("click", () => {
      i = (i + 1) % slides.length;
      show(i);
    });
    document.querySelector(".quote-prev")?.addEventListener("click", () => {
      i = (i - 1 + slides.length) % slides.length;
      show(i);
    });
  }

  // Form submit intercept (schedule page - no backend wired up)
  const form = document.querySelector(".appt-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const note = document.querySelector(".form-note");
      if (note)
        note.textContent =
          "Thanks! This demo form isn’t connected yet, but a real submission would land in your inbox here.";
    });
  }
});
