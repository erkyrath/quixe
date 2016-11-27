// Quixe gulpfile
// To build run "npm run build"

var gulp = require('gulp');
var concat = require('gulp-concat');
var replace = require('gulp-replace');
var uglify = require('gulp-uglify');

function compress(dest, sources) {
	return gulp.src(sources)
		.pipe(concat(dest))
		.pipe(replace(/;;;.+$/gm, ''))
		.pipe(uglify({ preserveComments: 'license' }))
		.pipe(gulp.dest('lib'));
}

gulp.task('default', ['glkote', 'elkote', 'quixe']);

gulp.task('glkote', function() {
	return compress('glkote.min.js', [
		'src/glkote/glkote.js',
		'src/glkote/dialog.js',
		'src/glkote/glkapi.js',
	]);
});

gulp.task('elkote', function() {
	return compress('elkote.min.js', [
		'src/glkote/glkote.js',
		'src/glkote/electrofs.js',
		'src/glkote/glkapi.js',
	]);
});

gulp.task('quixe', function() {
	return compress('quixe.min.js', [
		'src/quixe/quixe.js',
		'src/quixe/gi_dispa.js',
		'src/quixe/gi_load.js',
	]);
});
