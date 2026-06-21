document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // --- Profile Dropdown Toggle ---
  const profileDropdownBtn = document.getElementById('profileDropdownBtn');
  const profileDropdownMenu = document.getElementById('profileDropdownMenu');

  if (profileDropdownBtn && profileDropdownMenu) {
    
    profileDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdownMenu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!profileDropdownBtn.contains(e.target)) {
        profileDropdownMenu.classList.remove('active');
      }
    });
  }

  // --- Sidebar Navigation Active States & Page Toggles ---
  const navItems = document.querySelectorAll('.nav-item');
  const feedNavItem = document.querySelector('.sidebar-nav .nav-item:first-child');
  const shortsSidebarBtn = document.getElementById('shortsSidebarBtn');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      if (item === feedNavItem) {
        showFeedView();
      } else if (item === shortsSidebarBtn) {
        showShortsView();
      } else {
        // Other placeholder tabs
        const feedMainContent = document.getElementById('feedMainContent');
        const shortsSection = document.getElementById('shortsSection');
        if (feedMainContent && shortsSection) {
          shortsSection.style.display = 'none';
          feedMainContent.style.display = 'flex';
          if (feedNavItem) {
            navItems.forEach(nav => nav.classList.remove('active'));
            feedNavItem.classList.add('active');
          }
        }
        const text = item.querySelector('span').textContent;
        showToast(`${text} section coming soon!`);
      }
    });
  });

  // --- Like, Comment, Share, Bookmark, and More Options handler ---
  const postsContainer = document.getElementById('postsContainer');
  if (postsContainer) {
    postsContainer.addEventListener('click', (e) => {
      // 1. Like button click
      const likeBtn = e.target.closest('.like-btn');
      if (likeBtn) {
        const likeCountSpan = likeBtn.querySelector('.like-count');
        let currentLikes = parseInt(likeBtn.getAttribute('data-likes'), 10);
        
        if (likeBtn.classList.contains('liked')) {
          likeBtn.classList.remove('liked');
          currentLikes -= 1;
          showToast("Unliked post");
        } else {
          likeBtn.classList.add('liked');
          currentLikes += 1;
          showToast("Liked post!");
        }
        
        likeBtn.setAttribute('data-likes', currentLikes);
        if (likeCountSpan) {
          likeCountSpan.textContent = currentLikes;
        }
        return;
      }

      // 2. Bookmark button click
      const bookmarkBtn = e.target.closest('.post-bookmark-btn');
      if (bookmarkBtn) {
        bookmarkBtn.classList.toggle('bookmarked');
        const isBookmarked = bookmarkBtn.classList.contains('bookmarked');
        showToast(isBookmarked ? "Post added to Bookmarks" : "Post removed from Bookmarks");
        return;
      }

      // 3. Share button click
      const shareBtn = e.target.closest('.share-btn');
      if (shareBtn) {
        const actionLabel = shareBtn.querySelector('.action-label');
        let currentShares = parseInt(shareBtn.getAttribute('data-shares') || '0', 10);
        currentShares += 1;
        shareBtn.setAttribute('data-shares', currentShares);
        if (actionLabel) {
          actionLabel.textContent = `${currentShares} Share`;
        }
        showToast("Post link copied to clipboard! Shared successfully.");
        return;
      }

      // 4. Comment button click (Toggles mock comments section)
      const commentBtn = e.target.closest('.comment-btn');
      if (commentBtn) {
        const postCard = commentBtn.closest('.post-card');
        let commentsSection = postCard.querySelector('.post-comments-section');
        if (!commentsSection) {
          commentsSection = document.createElement('div');
          commentsSection.className = 'post-comments-section';
          commentsSection.style.cssText = 'padding: 16px 20px; border-top: 1px solid var(--border-color); background-color: var(--bg-app); border-bottom-left-radius: var(--border-radius-card); border-bottom-right-radius: var(--border-radius-card); display: flex; flex-direction: column; gap: 12px;';
          commentsSection.innerHTML = `
            <div class="comments-list" style="display: flex; flex-direction: column; gap: 10px;">
              <div style="display: flex; gap: 10px; align-items: flex-start;">
                <div class="avatar" style="width: 28px; height: 28px; flex-shrink: 0; overflow: hidden;"><img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&h=80&q=80" style="width:100%; height:100%; object-fit:cover;"></div>
                <div style="background: var(--bg-card); padding: 8px 12px; border-radius: 12px; font-size: 12.5px; border: 1px solid var(--border-color); flex: 1; color: var(--text-primary);">
                  <strong style="color: var(--text-primary); font-size: 12px; display: block; margin-bottom: 2px;">Justin Rosser</strong>
                  This looks incredible! Love the colors.
                </div>
              </div>
            </div>
            <div class="comment-input-row" style="display: flex; gap: 10px; align-items: center; margin-top: 8px;">
              <div class="avatar" style="width: 28px; height: 28px; flex-shrink: 0; overflow: hidden;"><img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&h=80&q=80" style="width:100%; height:100%; object-fit:cover;"></div>
              <div style="position: relative; flex: 1; display: flex; align-items: center;">
                <input type="text" placeholder="Write a comment..." class="comment-input" style="width: 100%; padding: 8px 36px 8px 12px; border-radius: 18px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); font-size: 12.5px; outline: none;">
                <button class="submit-comment-btn" style="position: absolute; right: 10px; color: var(--primary); background: none; border: none; cursor: pointer;"><i data-lucide="send" style="width: 14px; height: 14px;"></i></button>
              </div>
            </div>
          `;
          postCard.appendChild(commentsSection);
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        } else {
          commentsSection.style.display = commentsSection.style.display === 'none' ? 'flex' : 'none';
        }
        return;
      }

      // 5. Submit comment action
      const submitBtn = e.target.closest('.submit-comment-btn');
      if (submitBtn) {
        const row = submitBtn.closest('.comment-input-row');
        const input = row.querySelector('.comment-input');
        const text = input.value.trim();
        if (text) {
          const list = submitBtn.closest('.post-comments-section').querySelector('.comments-list');
          const item = document.createElement('div');
          item.style.cssText = 'display: flex; gap: 10px; align-items: flex-start;';
          item.innerHTML = `
            <div class="avatar" style="width: 28px; height: 28px; flex-shrink: 0; overflow: hidden;"><img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&h=80&q=80" style="width:100%; height:100%; object-fit:cover;"></div>
            <div style="background: var(--bg-card); padding: 8px 12px; border-radius: 12px; font-size: 12.5px; border: 1px solid var(--border-color); flex: 1; color: var(--text-primary);">
              <strong style="color: var(--text-primary); font-size: 12px; display: block; margin-bottom: 2px;">Jakob Botosh</strong>
              ${text}
            </div>
          `;
          list.appendChild(item);
          input.value = '';
          
          // Increment comment count
          const postCard = submitBtn.closest('.post-card');
          const commentBtn = postCard.querySelector('.comment-btn');
          const commentLabel = commentBtn.querySelector('.action-label');
          let count = parseInt(commentBtn.getAttribute('data-comments') || '0', 10);
          count++;
          commentBtn.setAttribute('data-comments', count);
          commentLabel.textContent = `${count} Comment`;
          showToast("Comment posted!");
        }
        return;
      }

      // 6. More Options click (Toggle dropdown)
      const optionsBtn = e.target.closest('.post-options-btn');
      if (optionsBtn) {
        const postCard = optionsBtn.closest('.post-card');
        let optionsMenu = postCard.querySelector('.post-options-menu');
        if (!optionsMenu) {
          // Close other menus first
          document.querySelectorAll('.post-options-menu').forEach(m => m.remove());
          
          optionsMenu = document.createElement('div');
          optionsMenu.className = 'dropdown-menu post-options-menu active';
          optionsMenu.style.cssText = 'position: absolute; right: 16px; top: 50px; width: 140px; display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--border-radius-item); box-shadow: var(--shadow-lg); z-index: 100;';
          optionsMenu.innerHTML = `
            <a href="#" class="hide-post-opt"><i data-lucide="eye-off" style="width:14px; height:14px; margin-right:8px;"></i> Hide Post</a>
            <a href="#" class="report-post-opt" style="color: var(--badge-red);"><i data-lucide="flag" style="width:14px; height:14px; margin-right:8px;"></i> Report</a>
          `;
          postCard.querySelector('.post-header').appendChild(optionsMenu);
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        } else {
          optionsMenu.remove();
        }
        return;
      }

      // 7. Hide post option
      const hideBtn = e.target.closest('.hide-post-opt');
      if (hideBtn) {
        e.preventDefault();
        const postCard = hideBtn.closest('.post-card');
        postCard.style.transition = 'transform 0.35s ease, opacity 0.35s ease';
        postCard.style.transform = 'scale(0.9)';
        postCard.style.opacity = '0';
        setTimeout(() => {
          postCard.remove();
          showToast("Post hidden from feed");
        }, 350);
        return;
      }

      // 8. Report post option
      const reportBtn = e.target.closest('.report-post-opt');
      if (reportBtn) {
        e.preventDefault();
        const postCard = reportBtn.closest('.post-card');
        postCard.style.transition = 'transform 0.35s ease, opacity 0.35s ease';
        postCard.style.transform = 'scale(0.9)';
        postCard.style.opacity = '0';
        setTimeout(() => {
          postCard.remove();
          showToast("Thank you for reporting. Post removed.");
        }, 350);
        return;
      }
    });

    // Close options menus when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.post-options-btn') && !e.target.closest('.post-options-menu')) {
        document.querySelectorAll('.post-options-menu').forEach(m => m.remove());
      }
    });

    // Submit comments on Enter key press
    postsContainer.addEventListener('keydown', (e) => {
      const commentInput = e.target.closest('.comment-input');
      if (commentInput && e.key === 'Enter') {
        const btn = commentInput.closest('.comment-input-row').querySelector('.submit-comment-btn');
        if (btn) btn.click();
      }
    });
  }

  // --- Messages Tabs Switching ---
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Since this is a demo, we highlight the tab.
      // In a full app we'd filter the list.
    });
  });

  // --- Mobile Drawer Toggle (Messages) ---
  const mobileMessagesBtn = document.getElementById('mobileMessagesBtn');
  const messagesDrawer = document.getElementById('messagesDrawer');
  const closeMessagesDrawer = document.getElementById('closeMessagesDrawer');
  const messagesDrawerContent = document.getElementById('messagesDrawerContent');
  const desktopMessagesCard = document.querySelector('.messages-card');

  if (mobileMessagesBtn && messagesDrawer && closeMessagesDrawer) {
    // Clone desktop messages to mobile drawer content once
    if (desktopMessagesCard && messagesDrawerContent) {
      const clonedCard = desktopMessagesCard.cloneNode(true);
      // Remove classes or adjust headers if needed
      messagesDrawerContent.appendChild(clonedCard);
      
      // Re-enable tabs event listeners on the cloned elements
      const clonedTabs = messagesDrawerContent.querySelectorAll('.tab-btn');
      clonedTabs.forEach(btn => {
        btn.addEventListener('click', () => {
          clonedTabs.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }

    mobileMessagesBtn.addEventListener('click', (e) => {
      e.preventDefault();
      messagesDrawer.classList.add('active');
      document.body.style.overflow = 'hidden'; // Prevent body scroll
    });

    closeMessagesDrawer.addEventListener('click', () => {
      messagesDrawer.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  // --- Mobile Left Sidebar Toggle ---
  const menuToggle = document.getElementById('menuToggle');
  const leftSidebar = document.getElementById('leftSidebar');

  if (menuToggle && leftSidebar) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      leftSidebar.classList.toggle('mobile-active');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768) {
        if (!leftSidebar.contains(e.target) && !menuToggle.contains(e.target)) {
          leftSidebar.classList.remove('mobile-active');
        }
      }
    });
  }

  // --- Create Post Logic ---
  const sharePostBtn = document.getElementById('sharePostBtn');
  const postInput = document.getElementById('postInput');

  if (sharePostBtn && postInput && postsContainer) {
    const handleSharePost = () => {
      const text = postInput.value.trim();
      if (!text) return;

      // Create new post card element
      const newPost = document.createElement('article');
      newPost.className = 'post-card';
      
      // Custom gradient backdrop for user created text posts
      const randomGradient = Math.floor(Math.random() * 3) + 1;
      let textPostBg = '';
      if (randomGradient === 1) textPostBg = 'linear-gradient(135deg, #1877f2, #8a2be2)';
      else if (randomGradient === 2) textPostBg = 'linear-gradient(135deg, #ea4c89, #b91d73)';
      else textPostBg = 'linear-gradient(135deg, #4caf50, #1e3c72)';

      newPost.innerHTML = `
        <header class="post-header">
          <div class="post-author-info">
            <div class="avatar author-avatar">
              <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80" alt="Jakob Botosh">
            </div>
            <div class="author-details">
              <h3 class="author-name">Jakob Botosh</h3>
              <span class="post-time">Just now</span>
            </div>
          </div>
          <button class="post-options-btn" aria-label="Post settings">
            <i data-lucide="more-horizontal"></i>
          </button>
        </header>
        
        <div class="post-content">
          <div style="padding: 30px 24px; background: ${textPostBg}; color: white; border-radius: 8px; margin: 0 20px; text-align: center; font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 600; box-shadow: var(--shadow-sm);">
            "${text}"
          </div>
        </div>
        
        <footer class="post-footer">
          <div class="post-actions">
            <button class="post-action-btn like-btn" data-likes="0">
              <i data-lucide="heart"></i>
              <span class="action-label"><span class="like-count">0</span> Like</span>
            </button>
            <button class="post-action-btn comment-btn" data-comments="0">
              <i data-lucide="message-circle"></i>
              <span class="action-label">0 Comment</span>
            </button>
            <button class="post-action-btn share-btn" data-shares="0">
              <i data-lucide="share-2"></i>
              <span class="action-label">0 Share</span>
            </button>
          </div>
          <button class="post-bookmark-btn" aria-label="Bookmark post">
            <i data-lucide="bookmark"></i>
          </button>
        </footer>
      `;

      // Prepend to posts container
      postsContainer.insertBefore(newPost, postsContainer.firstChild);
      
      // Clear input
      postInput.value = '';
      
      // Re-initialize Lucide Icons for new post
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      
      // Scroll to post smoothly
      newPost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    sharePostBtn.addEventListener('click', handleSharePost);
    postInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSharePost();
      }
    });
  }

  // --- Global Toast Notification Helper ---
  const showToast = (message) => {
    const toast = document.getElementById('appToast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.zIndex = '99999';
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(100px)';
    }, 2500);
  };

  // --- Notifications Dropdown Handling ---
  const notificationBtn = document.getElementById('notificationBtn');
  const notificationsDropdown = document.getElementById('notificationsDropdown');
  const notificationBadge = document.getElementById('notificationBadge');
  const markAllReadBtn = document.getElementById('markAllReadBtn');

  if (notificationBtn && notificationsDropdown) {
    notificationBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = notificationsDropdown.style.display === 'none';
      notificationsDropdown.style.display = isHidden ? 'block' : 'none';
      if (isHidden && notificationBadge) {
        notificationBadge.style.display = 'none'; // Clear badge
      }
    });

    document.addEventListener('click', (e) => {
      if (!notificationBtn.contains(e.target) && !notificationsDropdown.contains(e.target)) {
        notificationsDropdown.style.display = 'none';
      }
    });
  }

  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', () => {
      showToast("All notifications marked as read");
      if (notificationBadge) notificationBadge.style.display = 'none';
      notificationsDropdown.style.display = 'none';
    });
  }

  // --- Bookmarks Header Button ---
  const bookmarkBtn = document.getElementById('bookmarkBtn');
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener('click', () => {
      bookmarkBtn.classList.toggle('active');
      const isFiltering = bookmarkBtn.classList.contains('active');
      showToast(isFiltering ? "Filtering for bookmarked posts..." : "Showing all feed posts");
    });
  }

  // --- Privacy Dropdown Selection ---
  const privacyBtn = document.getElementById('privacyBtn');
  const privacyMenu = document.getElementById('privacyMenu');
  const privacyBtnText = document.getElementById('privacyBtnText');
  const privacyBtnIcon = document.getElementById('privacyBtnIcon');

  if (privacyBtn && privacyMenu) {
    privacyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = privacyMenu.style.display === 'none';
      privacyMenu.style.display = isHidden ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!privacyBtn.contains(e.target) && !privacyMenu.contains(e.target)) {
        privacyMenu.style.display = 'none';
      }
    });

    const privacyOptions = privacyMenu.querySelectorAll('.privacy-option');
    privacyOptions.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.preventDefault();
        const val = opt.getAttribute('data-value');
        const icon = opt.getAttribute('data-icon');
        if (privacyBtnText) privacyBtnText.textContent = val;
        if (privacyBtnIcon) {
          privacyBtnIcon.setAttribute('data-lucide', icon);
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        }
        privacyMenu.style.display = 'none';
        showToast(`Privacy set to ${val}`);
      });
    });
  }

  // --- Create Post Attachment Option Buttons ---
  const postOptBtns = document.querySelectorAll('.post-opt-btn');
  postOptBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.querySelector('span').textContent;
      showToast(`Option selected: ${type}`);
      const postInput = document.getElementById('postInput');
      if (postInput) postInput.focus();
    });
  });

  // --- Profile Dropdown Navigation Toasts ---
  const dropdownLinks = document.querySelectorAll('.dropdown-menu a');
  dropdownLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      // If it doesn't have specific class, trigger generic toast
      if (!link.classList.contains('privacy-option')) {
        const text = link.textContent.trim();
        showToast(`Navigating to ${text}...`);
      }
    });
  });

  // --- Mobile Bottom Navigation ---
  const mobileShortsBtn = document.getElementById('mobileShortsBtn');
  const mobileCreatePostBtn = document.getElementById('mobileCreatePostBtn');
  const mobileProfileBtn = document.getElementById('mobileProfileBtn');
  const mobileHomeBtn = document.getElementById('mobileHomeBtn');
  
  if (mobileShortsBtn) {
    mobileShortsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showShortsView();
    });
  }

  if (mobileCreatePostBtn) {
    mobileCreatePostBtn.addEventListener('click', (e) => {
      if (document.body.classList.contains('viewing-shorts')) {
        e.preventDefault();
        const shortModal = document.getElementById('shortCreateModal');
        if (shortModal) {
          shortModal.style.display = 'flex';
        }
        return;
      }
      e.preventDefault();
      const createPostCard = document.querySelector('.create-post-card');
      const postInput = document.getElementById('postInput');
      if (createPostCard) {
        createPostCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (postInput) setTimeout(() => postInput.focus(), 300);
      }
    });
  }

  if (mobileProfileBtn) {
    mobileProfileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const leftSidebar = document.getElementById('leftSidebar');
      if (leftSidebar) {
        leftSidebar.classList.toggle('mobile-active');
        const isActive = leftSidebar.classList.contains('mobile-active');
        showToast(isActive ? "Opening sidebar" : "Closing sidebar");
      }
    });
  }

  if (mobileHomeBtn) {
    mobileHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showFeedView();
    });
  }

  // --- Shorts Section Toggle Logic ---
  const backToFeedBtn = document.getElementById('backToFeedBtn');
  const feedMainContent = document.getElementById('feedMainContent');
  const shortsSection = document.getElementById('shortsSection');

  const updateNavActiveStates = (view) => {
    // Desktop Nav
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    
    // Mobile Nav
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => item.classList.remove('active'));

    if (view === 'shorts') {
      const shortsSidebarBtn = document.getElementById('shortsSidebarBtn');
      if (shortsSidebarBtn) shortsSidebarBtn.classList.add('active');
      const mobileShortsBtn = document.getElementById('mobileShortsBtn');
      if (mobileShortsBtn) mobileShortsBtn.classList.add('active');
    } else {
      const feedNavItem = document.querySelector('.sidebar-nav .nav-item:first-child');
      if (feedNavItem) feedNavItem.classList.add('active');
      if (mobileHomeBtn) mobileHomeBtn.classList.add('active');
    }
  };

  const showShortsView = () => {
    if (feedMainContent && shortsSection) {
      feedMainContent.style.display = 'none';
      shortsSection.style.display = 'flex';
      
      document.body.classList.add('viewing-shorts');
      updateNavActiveStates('shorts');
      
      // Scroll to top smoothly
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast("Viewing TrasX Shorts");
    }
  };

  const showFeedView = () => {
    if (feedMainContent && shortsSection) {
      shortsSection.style.display = 'none';
      feedMainContent.style.display = 'flex';
      
      document.body.classList.remove('viewing-shorts');
      updateNavActiveStates('feed');
      
      // Scroll to top smoothly
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast("Back to Feed");
    }
  };

  if (backToFeedBtn) {
    backToFeedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showFeedView();
    });
  }

  // Bind click listener on all stories (excluding the 'Add Story' card) to open Shorts
  const storyCards = document.querySelectorAll('.story-card:not(.add-story)');
  storyCards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      showShortsView();
    });
  });

  // --- Reels / Shorts Interactions ---
  // Direct Event Listeners for Reels Action Buttons and Drawer interactions
  const initAppReelCardEvents = (card) => {
    const reelId = card.getAttribute('data-reel-id');
    const likeBtn = card.querySelector('.reel-like-btn');
    const commentBtn = card.querySelector('.reel-comment-btn');
    const shareBtn = card.querySelector('.reel-share-btn');
    const closeDrawerBtn = card.querySelector('.close-comments-drawer-btn');
    const drawer = card.querySelector('.reel-comments-drawer');

    if (likeBtn) {
      likeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isLiked = !likeBtn.classList.contains('liked');
        likeBtn.classList.toggle('liked', isLiked);

        const countSpan = likeBtn.querySelector('.like-count');
        if (countSpan) {
          let count = parseInt(countSpan.textContent, 10) || 0;
          count = isLiked ? count + 1 : Math.max(0, count - 1);
          countSpan.textContent = count;
        }
      });
    }

    if (commentBtn) {
      commentBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (drawer) {
          const isOpen = drawer.classList.contains('open');
          if (isOpen) {
            drawer.classList.remove('open');
            document.body.classList.remove('comments-drawer-open');
          } else {
            // Close any other open drawers first to prevent stacking
            document.querySelectorAll('.reel-comments-drawer.open').forEach(openDrawer => {
              if (openDrawer !== drawer) {
                openDrawer.classList.remove('open');
              }
            });
            drawer.classList.add('open');
            document.body.classList.add('comments-drawer-open');
          }
        } else {
          const commentText = prompt("Ajouter un commentaire :");
          if (commentText && commentText.trim()) {
            const countSpan = commentBtn.querySelector('.comment-count');
            if (countSpan) {
              let count = parseInt(countSpan.textContent, 10) || 0;
              countSpan.textContent = count + 1;
            }
            if (typeof showToast === 'function') {
              showToast("Commentaire ajouté !");
            }
          }
        }
      });
    }

    if (shareBtn) {
      shareBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const shareUrl = `${window.location.origin}/?view=shorts#reel-${reelId}`;
        
        navigator.clipboard.writeText(shareUrl).then(() => {
          const countSpan = shareBtn.querySelector('.share-count');
          if (countSpan) {
            let count = parseInt(countSpan.textContent, 10) || 0;
            countSpan.textContent = count + 1;
          }
          if (typeof showToast === 'function') {
            showToast("Lien copié dans le presse-papiers !");
          }
        }).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      });
    }

    if (closeDrawerBtn && drawer) {
      closeDrawerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        drawer.classList.remove('open');
        document.body.classList.remove('comments-drawer-open');
      });
    }
  };

  // Initialize events for all reel cards
  document.querySelectorAll('.reel-card').forEach(card => {
    initAppReelCardEvents(card);
  });

  // --- Dark Mode / Theme Toggle Logic ---
  const themeToggleBtns = [
    document.getElementById('themeToggleBtn'),
    document.getElementById('mobileThemeToggleBtn')
  ].filter(Boolean);

  const getSavedTheme = () => localStorage.getItem('theme');
  const getSystemTheme = () => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  
  const applyTheme = (theme) => {
    if (theme === 'dark') {
      document.body.setAttribute('data-theme', 'dark');
    } else {
      document.body.removeAttribute('data-theme');
    }
  };

  // Apply saved or system theme initially
  const initialTheme = getSavedTheme() || getSystemTheme();
  applyTheme(initialTheme);

  // Bind click event listeners to toggle buttons
  themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const currentTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(currentTheme);
      localStorage.setItem('theme', currentTheme);
    });
  });

  // --- Header Search Bar Client-Side Filter ---
  const headerSearchInput = document.querySelector('.search-bar input');
  if (headerSearchInput) {
    headerSearchInput.addEventListener('input', () => {
      const query = headerSearchInput.value.trim().toLowerCase();
      const postCards = document.querySelectorAll('#postsContainer .post-card, .posts-list .post-card');
      postCards.forEach(card => {
        const postContent = card.querySelector('.post-content');
        const authorName = card.querySelector('.author-name');
        const contentText = postContent ? postContent.textContent.toLowerCase() : '';
        const authorText = authorName ? authorName.textContent.toLowerCase() : '';
        
        if (contentText.includes(query) || authorText.includes(query)) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  }

  // --- Shorts Keyboard Navigation ---
  document.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('viewing-shorts')) {
      const reelsFeed = document.querySelector('.reels-feed');
      if (reelsFeed) {
        const cardHeight = reelsFeed.clientHeight || reelsFeed.offsetHeight;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          reelsFeed.scrollBy({ top: cardHeight, behavior: 'smooth' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          reelsFeed.scrollBy({ top: -cardHeight, behavior: 'smooth' });
        }
      }
    }
  });

});
