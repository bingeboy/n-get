#!/usr/bin/env node

/**
 * Enhanced UI Demo for n-get
 * Shows the beautiful progress bars, emojis, and user-friendly interface
 */

const ui = require('../lib/ui');

async function demoUI() {
    // Show banner
    ui.displayBanner();
    
    console.log('\n' + '🎨 Enhanced UI Features Demo'.bold.cyan);
    console.log('━'.repeat(50).gray);
    
    // Demo info messages
    ui.displayInfo('This demo showcases the enhanced UI features');
    ui.displaySuccess('Beautiful UTF-8 emojis and colors');
    ui.displayWarning('Cross-platform compatibility');
    ui.displayError('Graceful error handling');
    
    console.log('\n📁 File Type Emojis:');
    const testFiles = [
        'document.pdf',
        'archive.zip',
        'photo.jpg',
        'movie.mp4',
        'song.mp3',
        'script.js',
        'data.csv'
    ];
    
    testFiles.forEach(file => {
        const emoji = ui.getFileTypeEmoji(file);
        console.log(`  ${emoji} ${file}`);
    });
    
    console.log('\n⚡ Spinner Demo:');
    
    // Demo spinners
    const spinner1 = ui.createSpinner('Processing files...', ui.emojis.gear);
    spinner1.spinner.start();
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    spinner1.spinner.succeed('Files processed successfully');
    
    const spinner2 = ui.createSpinner('Connecting to server...', ui.emojis.network);
    spinner2.spinner.start();
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    spinner2.spinner.fail('Connection failed - demo only');
    
    // Demo progress bar
    console.log('\n📊 Progress Bar Demo:');
    const progressBar = ui.createProgressBar('demo-file.zip', 1000000);
    
    for (let i = 0; i <= 100; i += 10) {
        progressBar.update(i * 10000, { speed: '1.2 MB/s' });
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Demo summary
    ui.displaySummary({
        totalFiles: 5,
        successCount: 4,
        errorCount: 1,
        totalBytes: 15 * 1024 * 1024, // 15 MB
        totalTime: 12500, // 12.5 seconds
        averageSpeed: 1.2 * 1024 * 1024 // 1.2 MB/s
    });
    
    console.log('\n🎉 Demo complete! Run n-get with real URLs to see it in action.'.green.bold);
    
    ui.cleanup();
}

// Only run demo if called directly
if (require.main === module) {
    demoUI().catch(console.error);
}

module.exports = { demoUI };