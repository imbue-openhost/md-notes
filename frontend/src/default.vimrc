" Default vimrc (based on ~/.ideavimrc)

let mapleader = ","

" Use jk for esc in insert mode
inoremap jk <Esc>
inoremap Jk <Esc>
inoremap JK <Esc>
inoremap jK <Esc>

" Case insensitive search (smart: case-sensitive if uppercase used)
set ignorecase
set smartcase
set incsearch

" Navigate visual lines, not logical lines
nnoremap j gj
nnoremap k gk
xnoremap j gj
xnoremap k gk

" Vim-easyclip emulation: d/x delete to black hole, m cuts.
" Normal-mode `m` is registered as a direct operator (not keyToKey) in
" vim.ts because codemirror-vim's key matcher fires full matches
" immediately — a keyToKey `m`→`d` would always consume the key before
" `mm` could match. As a direct operator, `mm` works via the built-in
" "same operator twice = linewise" logic.
nnoremap d "_d
xnoremap d "_d
nnoremap dd "_dd
nnoremap D "_D
xnoremap D "_D
nnoremap x "_x
xnoremap x "_x
xnoremap m d

" Folding
exmap togglefold toggle-fold
exmap foldall fold-all
exmap unfoldall unfold-all
exmap foldcursor fold-at-cursor
exmap unfoldcursor unfold-at-cursor
nmap zo :togglefold<CR>
nmap zc :foldcursor<CR>
nmap za :togglefold<CR>
nmap zM :foldall<CR>
nmap zR :unfoldall<CR>

" Toggle GFM task checkbox on the current line
exmap toggletask toggle-task
nmap <leader>x :toggletask<CR>
xmap <leader>x :toggletask<CR>
